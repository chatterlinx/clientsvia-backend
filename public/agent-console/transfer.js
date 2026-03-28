'use strict';

/**
 * ============================================================================
 * TRANSFER & ROUTING CONSOLE — Frontend Controller
 * ============================================================================
 *
 * Drives the transfer.html enterprise routing configuration page.
 * Manages: destinations (employees, departments, externals),
 * company schedule, caller screening, telemarketer policy,
 * emergency override, and AI protocol settings.
 *
 * STATE SHAPE:
 *   state.companyId  — from URL ?companyId=
 *   state.policy     — TransferPolicy document (singleton)
 *   state.dests      — Array<TransferDestination>
 *   state.editingId  — null (create mode) or destination _id (edit mode)
 *   state.filter     — 'all' | 'agent' | 'department' | 'external'
 *   state.search     — search string
 *   state.dirty      — whether unsaved changes exist in protocol tab
 *
 * API BASE: /api/admin/agent2/company/:companyId/transfer
 * ============================================================================
 */

// ── State ─────────────────────────────────────────────────────────────────────

const state = {
  companyId:  null,
  companyName: '',
  policy:     null,
  dests:      [],
  editingId:  null,
  filter:     'all',
  search:     '',
  dirty:      false
};

// ── Timezone list (most common) ───────────────────────────────────────────────
const TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix',
  'America/Los_Angeles', 'America/Anchorage', 'America/Adak', 'Pacific/Honolulu',
  'America/Toronto', 'America/Vancouver', 'America/Mexico_City',
  'America/Sao_Paulo', 'America/Argentina/Buenos_Aires',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid',
  'Europe/Rome', 'Europe/Moscow', 'Africa/Johannesburg',
  'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo',
  'Asia/Shanghai', 'Asia/Seoul', 'Australia/Sydney', 'Pacific/Auckland'
];

const DAYS = ['mon','tue','wed','thu','fri','sat','sun'];
const DAY_LABELS = { mon:'Monday', tue:'Tuesday', wed:'Wednesday', thu:'Thursday', fri:'Friday', sat:'Saturday', sun:'Sunday' };

// ── API helpers ───────────────────────────────────────────────────────────────

function apiBase() {
  return `/api/admin/agent2/company/${state.companyId}/transfer`;
}

function getToken() {
  return localStorage.getItem('token') || sessionStorage.getItem('token') || '';
}

async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${apiBase()}${path}`, opts);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || `API error ${res.status}`);
  return data;
}

// ── Toast notifications ───────────────────────────────────────────────────────

function toast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      ${type === 'success'
        ? '<polyline points="20 6 9 17 4 12"/>'
        : type === 'error'
          ? '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'
          : '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'}
    </svg>
    <span>${message}</span>
  `;
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(30px)'; el.style.transition = '.2s'; }, 2800);
  setTimeout(() => el.remove(), 3100);
}

// ── Tab navigation ────────────────────────────────────────────────────────────

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`panel-${tab}`).classList.add('active');

      // Show/hide save button based on tab
      const saveBtn = document.getElementById('btnSaveProtocol');
      saveBtn.style.display = tab === 'protocol' ? 'inline-flex' : 'none';
    });
  });
}

// ── Load company info ─────────────────────────────────────────────────────────

async function loadCompanyName() {
  try {
    const res = await fetch(`/api/v2company/${state.companyId}`, {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    if (res.ok) {
      const data = await res.json();
      const name = data.company?.companyName || data.name || state.companyId;
      state.companyName = name;
      document.getElementById('headerCompanyName').textContent = name;
    }
  } catch (_) {
    document.getElementById('headerCompanyName').textContent = state.companyId;
  }
}

// ── Load all data ─────────────────────────────────────────────────────────────

async function loadAll() {
  try {
    const [destData, policyData] = await Promise.all([
      api('GET', '/destinations'),
      api('GET', '/policy')
    ]);

    state.dests  = destData.destinations || [];
    state.policy = policyData.policy || {};

    renderAll();
  } catch (err) {
    toast('Failed to load transfer configuration: ' + err.message, 'error');
  }
}

// ── Render all sections ───────────────────────────────────────────────────────

function renderAll() {
  renderStats();
  renderDestGrid();
  renderPolicyToUI();
  renderScheduleTab();
  renderScreeningTab();
  updateEmergencyBanner();
  updateTabCounts();
}

// ── Stats row ─────────────────────────────────────────────────────────────────

function renderStats() {
  const agents   = state.dests.filter(d => d.type === 'agent').length;
  const depts    = state.dests.filter(d => d.type === 'department').length;
  const transfers = state.dests.reduce((s, d) => s + (d.stats?.transferCount || 0), 0);

  document.getElementById('statTotal').textContent   = state.dests.length;
  document.getElementById('statAgents').textContent  = agents;
  document.getElementById('statDepts').textContent   = depts;
  document.getElementById('statTransfers').textContent = transfers.toLocaleString();
}

// ── Tab counts ────────────────────────────────────────────────────────────────

function updateTabCounts() {
  document.getElementById('tabCountDirectory').textContent = state.dests.length;

  const vips    = state.policy?.callerScreening?.vipList?.length    || 0;
  const blocked = state.policy?.callerScreening?.blocklist?.length   || 0;
  document.getElementById('tabCountScreening').textContent = vips + blocked;
}

// ── Destination cards ─────────────────────────────────────────────────────────

function renderDestGrid() {
  const grid    = document.getElementById('destGrid');
  const empty   = document.getElementById('emptyState');

  let filtered = state.dests;

  if (state.filter !== 'all') {
    filtered = filtered.filter(d => d.type === state.filter);
  }

  if (state.search.trim()) {
    const q = state.search.toLowerCase();
    filtered = filtered.filter(d =>
      (d.name || '').toLowerCase().includes(q) ||
      (d.title || '').toLowerCase().includes(q) ||
      (d.departmentName || '').toLowerCase().includes(q) ||
      (d.phoneNumber || '').includes(q)
    );
  }

  if (!filtered.length) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');

  grid.innerHTML = filtered.map(d => destCardHTML(d)).join('');

  // Attach event listeners
  grid.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => openDrawer(btn.dataset.edit));
  });
  grid.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', () => promptDelete(btn.dataset.delete, btn.dataset.name));
  });
  grid.querySelectorAll('[data-toggle-enable]').forEach(tog => {
    tog.addEventListener('change', () => toggleDestEnabled(tog.dataset.toggleEnable, tog.checked));
  });
}

function destCardHTML(d) {
  const typeEmoji = d.type === 'agent' ? '👤' : d.type === 'department' ? '🏢' : '📞';
  const typeBadge = `badge-${d.type}`;
  const typeLabel = d.type === 'agent' ? 'Employee' : d.type === 'department' ? 'Department' : 'External';
  const modeBadge = (d.transferContext?.mode === 'cold') ? 'badge-cold' : 'badge-warm';
  const modeLabel = (d.transferContext?.mode === 'cold') ? '❄️ Cold' : '🌡️ Warm';
  const status    = d.enabled ? 'badge-online' : 'badge-disabled';
  const statusLbl = d.enabled ? '● Active' : '○ Disabled';

  const missedSms   = d.notifications?.onMissedCall?.smsEnabled   ? 'active-sms'   : 'inactive';
  const missedEmail = d.notifications?.onMissedCall?.emailEnabled  ? 'active-email' : 'inactive';
  const vmSms       = d.notifications?.onVoicemail?.smsEnabled     ? 'active-sms'   : 'inactive';
  const vmEmail     = d.notifications?.onVoicemail?.emailEnabled   ? 'active-email' : 'inactive';

  const overflowLabel = overflowActionLabel(d.overflow?.action);
  const schedLabel    = d.schedule?.followCompany ? 'Company Hours' : 'Custom Hours';

  const phone = d.phoneNumber || '<span class="text-muted">No phone set</span>';
  const dept  = d.departmentName ? `<span class="text-muted">${d.departmentName}</span>` : '';
  const title = [d.title, d.departmentName].filter(Boolean).join(' · ') || typeLabel;

  return `
    <div class="dest-card${d.enabled ? '' : ' disabled'}" data-id="${d._id}">
      <div class="dest-card-header">
        <div class="dest-avatar type-${d.type}">${typeEmoji}</div>
        <div class="dest-card-info">
          <div class="dest-name">${escHtml(d.name)}</div>
          <div class="dest-title">${escHtml(title)}</div>
        </div>
        <label class="toggle" title="${d.enabled ? 'Click to disable' : 'Click to enable'}">
          <input type="checkbox" data-toggle-enable="${d._id}" ${d.enabled ? 'checked' : ''} />
          <span class="toggle-slider"></span>
        </label>
      </div>

      <div class="dest-card-badges">
        <span class="badge ${typeBadge}">${typeLabel}</span>
        <span class="badge ${modeBadge}">${modeLabel}</span>
        <span class="badge ${status}">${statusLbl}</span>
      </div>

      <div class="dest-card-details">
        <div class="dest-detail">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.1 19.79 19.79 0 0 1 1.58 4.5 2 2 0 0 1 3.55 2.36h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.08 6.08l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
          <span class="dest-detail-text font-mono">${escHtml(d.phoneNumber || '—')}</span>
        </div>
        <div class="dest-detail">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <span class="dest-detail-text">${schedLabel}</span>
        </div>
        <div class="dest-detail" style="grid-column:span 2;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          <span class="dest-detail-text overflow-chip">${overflowLabel}</span>
        </div>
      </div>

      <div class="dest-card-footer">
        <div class="dest-notify-icons" title="Notifications: Missed Call SMS / Email · Voicemail SMS / Email">
          <div class="notify-icon ${missedSms}"  title="Missed call SMS">📱</div>
          <div class="notify-icon ${missedEmail}" title="Missed call email">📧</div>
          <div class="notify-icon ${vmSms}"       title="Voicemail SMS">💬</div>
          <div class="notify-icon ${vmEmail}"     title="Voicemail email">✉️</div>
          ${d.stats?.transferCount ? `<span class="text-muted text-small">&nbsp;${d.stats.transferCount} transfers</span>` : ''}
        </div>
        <div class="dest-card-actions">
          <button class="btn btn-secondary btn-sm" data-edit="${d._id}">Edit</button>
          <button class="btn btn-ghost btn-sm" data-delete="${d._id}" data-name="${escHtml(d.name)}" title="Delete">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
        </div>
      </div>
    </div>
  `;
}

function overflowActionLabel(action) {
  const labels = {
    voicemail:            '📬 Voicemail',
    forward_number:       '📲 Forward →',
    forward_destination:  '🔀 Route to →',
    message_hangup:       '💬 Message + Hangup'
  };
  return labels[action] || '📬 Voicemail';
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Destination enable/disable toggle ─────────────────────────────────────────

async function toggleDestEnabled(destId, enabled) {
  try {
    await api('PATCH', `/destinations/${destId}`, { enabled });
    const dest = state.dests.find(d => d._id === destId);
    if (dest) dest.enabled = enabled;
    renderDestGrid();
    renderStats();
    toast(enabled ? 'Destination enabled' : 'Destination disabled');
  } catch (err) {
    toast('Failed to update destination: ' + err.message, 'error');
    // Revert UI
    renderDestGrid();
  }
}

// ── Delete destination ────────────────────────────────────────────────────────

let _pendingDeleteId = null;

function promptDelete(destId, name) {
  _pendingDeleteId = destId;
  document.getElementById('deleteModalBody').textContent =
    `Are you sure you want to permanently delete "${name}"? This action cannot be undone.`;
  document.getElementById('deleteModal').classList.add('open');
}

document.getElementById('btnDeleteCancel').addEventListener('click', () => {
  document.getElementById('deleteModal').classList.remove('open');
  _pendingDeleteId = null;
});

document.getElementById('btnDeleteConfirm').addEventListener('click', async () => {
  if (!_pendingDeleteId) return;
  try {
    await api('DELETE', `/destinations/${_pendingDeleteId}/hard`);
    state.dests = state.dests.filter(d => d._id !== _pendingDeleteId);
    document.getElementById('deleteModal').classList.remove('open');
    _pendingDeleteId = null;
    renderDestGrid();
    renderStats();
    updateTabCounts();
    toast('Destination deleted');
  } catch (err) {
    toast('Delete failed: ' + err.message, 'error');
  }
});

// ── DRAWER — open, populate, save ─────────────────────────────────────────────

function openDrawer(destId = null) {
  state.editingId = destId;

  const isNew = !destId;
  document.getElementById('drawerTitle').textContent    = isNew ? 'Add Transfer Destination' : 'Edit Destination';
  document.getElementById('drawerSubtitle').textContent = isNew ? 'Configure every detail of this new routing destination' : 'Update configuration for this destination';
  document.getElementById('btnDeleteDest').classList.toggle('hidden', isNew);

  // Populate department dropdown
  populateDeptDropdown();
  populateOverflowDestDropdown(destId);

  if (isNew) {
    resetDrawerForm();
  } else {
    const dest = state.dests.find(d => d._id === destId);
    if (dest) populateDrawerForm(dest);
  }

  renderDestDaysGrid();

  document.getElementById('drawerOverlay').classList.add('open');
  document.getElementById('destDrawer').classList.add('open');
}

function closeDrawer() {
  document.getElementById('drawerOverlay').classList.remove('open');
  document.getElementById('destDrawer').classList.remove('open');
  state.editingId = null;
}

function resetDrawerForm() {
  // Identity
  setTypeCard('agent');
  document.getElementById('destName').value    = '';
  document.getElementById('destTitle').value   = '';
  document.getElementById('destPhone').value   = '';
  document.getElementById('destEmail').value   = '';
  document.getElementById('destPriority').value = '100';
  document.getElementById('destDeptId').value  = '';
  document.getElementById('destEnabled').checked = true;

  // Schedule
  selectSchedMode('company');

  // Overflow
  selectOverflow('voicemail');
  document.getElementById('overflowForwardNumber').value = '';
  document.getElementById('overflowForwardDestId').value = '';
  document.getElementById('overflowMessage').value = '';
  document.getElementById('voicemailGreeting').value = '';
  document.getElementById('voicemailTranscription').checked = true;

  // Notifications
  document.getElementById('missedSmsEnabled').checked   = false;
  document.getElementById('missedSmsTo').value          = '';
  document.getElementById('missedEmailEnabled').checked = false;
  document.getElementById('missedEmailTo').value        = '';
  document.getElementById('vmSmsEnabled').checked       = true;
  document.getElementById('vmSmsTo').value              = '';
  document.getElementById('vmEmailEnabled').checked     = true;
  document.getElementById('vmEmailTo').value            = '';
  document.getElementById('vmIncludeTranscript').checked = true;

  // Transfer settings
  selectDestTransferMode('warm');
  document.getElementById('destSendCallerSummary').checked  = true;
  document.getElementById('destIncludeDiscovery').checked   = true;
  document.getElementById('destSummaryTemplate').value      = '';

  // Caller access
  document.getElementById('accessAllowAll').checked           = true;
  document.getElementById('accessBlockTelemarketers').checked = true;
  document.getElementById('accessRequireScreening').checked   = false;

  // Calendar
  document.getElementById('destCalendarProvider').value       = '';
  document.getElementById('destCalendarUrl').value            = '';
  document.getElementById('destCalendarSelfService').checked  = false;
  document.getElementById('destNotes').value                  = '';
}

function populateDrawerForm(d) {
  // Identity
  setTypeCard(d.type || 'agent');
  document.getElementById('destName').value     = d.name || '';
  document.getElementById('destTitle').value    = d.title || '';
  document.getElementById('destPhone').value    = d.phoneNumber || '';
  document.getElementById('destEmail').value    = d.email || '';
  document.getElementById('destPriority').value = d.priority || 100;
  document.getElementById('destDeptId').value   = d.departmentId || '';
  document.getElementById('destEnabled').checked = d.enabled !== false;

  // Schedule
  const followCompany = d.schedule?.followCompany !== false;
  selectSchedMode(followCompany ? 'company' : 'custom');

  // Render custom days grid with destination's hours
  renderDestDaysGrid(d.schedule?.weekly);

  // Overflow
  const oa = d.overflow?.action || 'voicemail';
  selectOverflow(oa);
  document.getElementById('overflowForwardNumber').value  = d.overflow?.forwardToNumber || '';
  document.getElementById('overflowForwardDestId').value  = d.overflow?.forwardToDestinationId || '';
  document.getElementById('overflowMessage').value        = d.overflow?.hangupMessage || '';
  document.getElementById('voicemailGreeting').value      = d.overflow?.voicemailGreeting || '';
  document.getElementById('voicemailTranscription').checked = d.overflow?.voicemailTranscription !== false;

  // Notifications
  const mc = d.notifications?.onMissedCall || {};
  document.getElementById('missedSmsEnabled').checked   = mc.smsEnabled   || false;
  document.getElementById('missedSmsTo').value          = mc.smsTo        || '';
  document.getElementById('missedEmailEnabled').checked = mc.emailEnabled || false;
  document.getElementById('missedEmailTo').value        = mc.emailTo      || '';

  const vm = d.notifications?.onVoicemail || {};
  document.getElementById('vmSmsEnabled').checked       = vm.smsEnabled   !== false;
  document.getElementById('vmSmsTo').value              = vm.smsTo        || '';
  document.getElementById('vmEmailEnabled').checked     = vm.emailEnabled !== false;
  document.getElementById('vmEmailTo').value            = vm.emailTo      || '';
  document.getElementById('vmIncludeTranscript').checked = vm.includeTranscript !== false;

  // Transfer context
  const tc = d.transferContext || {};
  selectDestTransferMode(tc.mode || 'warm');
  document.getElementById('destSendCallerSummary').checked = tc.sendCallerSummary !== false;
  document.getElementById('destIncludeDiscovery').checked  = tc.includeDiscoveryNotes !== false;
  document.getElementById('destSummaryTemplate').value     = tc.summaryTemplate || '';

  // Caller access
  const ca = d.callerAccess || {};
  document.getElementById('accessAllowAll').checked           = ca.allowAll !== false;
  document.getElementById('accessBlockTelemarketers').checked = ca.blockTelemarketers !== false;
  document.getElementById('accessRequireScreening').checked   = ca.requireScreening || false;

  // Calendar
  const cal = d.calendar || {};
  document.getElementById('destCalendarProvider').value      = cal.provider || '';
  document.getElementById('destCalendarUrl').value           = cal.calendarUrl || '';
  document.getElementById('destCalendarSelfService').checked = cal.allowSelfService || false;
  document.getElementById('destNotes').value                 = d.internalNotes || '';
}

function collectDrawerForm() {
  const followCompany = document.getElementById('destFollowCompany').value === 'true';

  // Collect custom weekly hours
  const weekly = {};
  if (!followCompany) {
    DAYS.forEach(day => {
      const row = document.querySelector(`[data-day="${day}"]`);
      if (!row) return;
      const enabled = row.querySelector('.day-toggle')?.checked || false;
      const open    = row.querySelector('.day-open')?.value || '08:00';
      const close   = row.querySelector('.day-close')?.value || '17:00';
      weekly[day] = { enabled, open, close };
    });
  }

  const overflowAction = document.querySelector('input[name="destOverflow"]:checked')?.value || 'voicemail';

  return {
    type:           document.getElementById('destType').value,
    name:           document.getElementById('destName').value.trim(),
    title:          document.getElementById('destTitle').value.trim(),
    phoneNumber:    document.getElementById('destPhone').value.trim(),
    email:          document.getElementById('destEmail').value.trim(),
    priority:       parseInt(document.getElementById('destPriority').value) || 100,
    departmentId:   document.getElementById('destDeptId').value || '',
    departmentName: document.getElementById('destDeptId').selectedOptions[0]?.text?.replace('— None / Standalone —', '') || '',
    enabled:        document.getElementById('destEnabled').checked,

    schedule: {
      followCompany,
      weekly: followCompany ? undefined : weekly
    },

    overflow: {
      action:                  overflowAction,
      forwardToNumber:         document.getElementById('overflowForwardNumber').value.trim(),
      forwardToDestinationId:  document.getElementById('overflowForwardDestId').value,
      forwardToDestinationName: document.getElementById('overflowForwardDestId').selectedOptions[0]?.text || '',
      hangupMessage:           document.getElementById('overflowMessage').value.trim(),
      voicemailGreeting:       document.getElementById('voicemailGreeting').value.trim(),
      voicemailTranscription:  document.getElementById('voicemailTranscription').checked
    },

    notifications: {
      onMissedCall: {
        smsEnabled:   document.getElementById('missedSmsEnabled').checked,
        smsTo:        document.getElementById('missedSmsTo').value.trim(),
        emailEnabled: document.getElementById('missedEmailEnabled').checked,
        emailTo:      document.getElementById('missedEmailTo').value.trim()
      },
      onVoicemail: {
        smsEnabled:        document.getElementById('vmSmsEnabled').checked,
        smsTo:             document.getElementById('vmSmsTo').value.trim(),
        emailEnabled:      document.getElementById('vmEmailEnabled').checked,
        emailTo:           document.getElementById('vmEmailTo').value.trim(),
        includeTranscript: document.getElementById('vmIncludeTranscript').checked
      }
    },

    transferContext: {
      mode:                 document.getElementById('destTransferMode').value,
      sendCallerSummary:    document.getElementById('destSendCallerSummary').checked,
      includeDiscoveryNotes: document.getElementById('destIncludeDiscovery').checked,
      summaryTemplate:      document.getElementById('destSummaryTemplate').value.trim()
    },

    callerAccess: {
      allowAll:           document.getElementById('accessAllowAll').checked,
      blockTelemarketers: document.getElementById('accessBlockTelemarketers').checked,
      requireScreening:   document.getElementById('accessRequireScreening').checked
    },

    calendar: {
      provider:         document.getElementById('destCalendarProvider').value,
      calendarUrl:      document.getElementById('destCalendarUrl').value.trim(),
      allowSelfService: document.getElementById('destCalendarSelfService').checked
    },

    internalNotes: document.getElementById('destNotes').value.trim()
  };
}

document.getElementById('btnSaveDest').addEventListener('click', async () => {
  const body = collectDrawerForm();

  if (!body.name) {
    toast('Name is required', 'error');
    document.getElementById('destName').focus();
    return;
  }

  const btn = document.getElementById('btnSaveDest');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    let result;
    if (state.editingId) {
      result = await api('PATCH', `/destinations/${state.editingId}`, body);
      const idx = state.dests.findIndex(d => d._id === state.editingId);
      if (idx !== -1) state.dests[idx] = result.destination;
      toast('Destination updated');
    } else {
      result = await api('POST', '/destinations', body);
      state.dests.unshift(result.destination);
      toast('Destination created');
    }

    closeDrawer();
    renderDestGrid();
    renderStats();
    updateTabCounts();
    populateDeptDropdown();
  } catch (err) {
    toast('Save failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save Destination`;
  }
});

document.getElementById('btnDeleteDest').addEventListener('click', () => {
  if (!state.editingId) return;
  const dest = state.dests.find(d => d._id === state.editingId);
  closeDrawer();
  promptDelete(state.editingId, dest?.name || 'this destination');
});

document.getElementById('btnCancelDest').addEventListener('click', closeDrawer);
document.getElementById('drawerClose').addEventListener('click', closeDrawer);
document.getElementById('drawerOverlay').addEventListener('click', closeDrawer);

// ── Type card selector ────────────────────────────────────────────────────────

function setTypeCard(type) {
  document.getElementById('destType').value = type;
  document.querySelectorAll('#typeCards .type-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.type === type);
  });
  // Show/hide title and dept fields based on type
  const hasDept  = type === 'agent';
  const hasTitle = type !== 'external';
  document.getElementById('titleGroup').style.display = hasTitle ? '' : 'none';
  document.getElementById('deptGroup').style.display  = hasDept  ? '' : 'none';
}

document.querySelectorAll('#typeCards .type-card').forEach(c => {
  c.addEventListener('click', () => setTypeCard(c.dataset.type));
});

// ── Schedule mode selector ────────────────────────────────────────────────────

function selectSchedMode(mode) {
  document.getElementById('destFollowCompany').value = (mode === 'company').toString();
  document.getElementById('schedModeCompany').classList.toggle('selected', mode === 'company');
  document.getElementById('schedModeCustom').classList.toggle('selected', mode === 'custom');
  document.getElementById('customScheduleWrap').classList.toggle('hidden', mode === 'company');
}

document.getElementById('schedModeCompany').addEventListener('click', () => selectSchedMode('company'));
document.getElementById('schedModeCustom').addEventListener('click',  () => {
  selectSchedMode('custom');
  renderDestDaysGrid();
});

// ── Destination days grid (compact, in drawer) ────────────────────────────────

function renderDestDaysGrid(weekly = {}) {
  const container = document.getElementById('destDaysGrid');
  container.innerHTML = DAYS.map(day => {
    const data    = weekly?.[day] || {};
    const enabled = data.enabled !== undefined ? data.enabled : (day !== 'sat' && day !== 'sun');
    const open    = data.open  || '08:00';
    const close   = data.close || '17:00';
    return `
      <div class="day-row-compact${enabled ? ' enabled' : ''}" data-day="${day}">
        <span class="day-name">${DAY_LABELS[day]}</span>
        <label class="toggle">
          <input type="checkbox" class="day-toggle" ${enabled ? 'checked' : ''} onchange="
            const row = this.closest('[data-day]');
            row.classList.toggle('enabled', this.checked);
            row.querySelectorAll('.day-open,.day-close').forEach(i => i.disabled = !this.checked);
          " />
          <span class="toggle-slider"></span>
        </label>
        <div class="day-times">
          <input type="time" class="time-input day-open"  value="${open}"  ${enabled ? '' : 'disabled'} />
          <span class="time-sep">–</span>
          <input type="time" class="time-input day-close" value="${close}" ${enabled ? '' : 'disabled'} />
          ${enabled ? '' : '<span class="day-closed-label">Closed</span>'}
        </div>
      </div>
    `;
  }).join('');
}

// ── Overflow action selector ──────────────────────────────────────────────────

window.selectOverflow = function (action) {
  document.querySelectorAll('#overflowActionOptions .overflow-option').forEach(opt => {
    opt.classList.toggle('selected', opt.querySelector('input').value === action);
    if (opt.querySelector('input').value === action) opt.querySelector('input').checked = true;
  });
  document.getElementById('overflowForwardNumberWrap').style.display = action === 'forward_number'      ? '' : 'none';
  document.getElementById('overflowForwardDestWrap').style.display   = action === 'forward_destination' ? '' : 'none';
  document.getElementById('overflowMessageWrap').style.display       = action === 'message_hangup'      ? '' : 'none';
};

// ── Transfer mode selector (drawer) ──────────────────────────────────────────

function selectDestTransferMode(mode) {
  document.getElementById('destTransferMode').value = mode;
  document.querySelectorAll('#destTransferModeCards .transfer-mode-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.mode === mode);
  });
}

document.querySelectorAll('#destTransferModeCards .transfer-mode-card').forEach(c => {
  c.addEventListener('click', () => selectDestTransferMode(c.dataset.mode));
});

// ── Department dropdown population ───────────────────────────────────────────

function populateDeptDropdown() {
  const depts = state.dests.filter(d => d.type === 'department' && d.enabled);
  const selects = ['destDeptId'];
  selects.forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = `<option value="">— None / Standalone —</option>` +
      depts.map(d => `<option value="${d._id}"${d._id === current ? ' selected' : ''}>${escHtml(d.name)}</option>`).join('');
  });
}

function populateOverflowDestDropdown(excludeId = null) {
  const sel = document.getElementById('overflowForwardDestId');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = `<option value="">— Select destination —</option>` +
    state.dests
      .filter(d => d._id !== excludeId && d.enabled)
      .map(d => `<option value="${d._id}"${d._id === current ? ' selected' : ''}>${escHtml(d.name)}</option>`)
      .join('');
}

// ── Add buttons ───────────────────────────────────────────────────────────────

document.getElementById('btnAddEmployee').addEventListener('click', () => { setTypeCard('agent');  openDrawer(null); });
document.getElementById('btnAddDept').addEventListener('click',     () => { setTypeCard('department'); openDrawer(null); });
document.getElementById('btnEmptyEmployee')?.addEventListener('click', () => { setTypeCard('agent');  openDrawer(null); });
document.getElementById('btnEmptyDept')?.addEventListener('click',     () => { setTypeCard('department'); openDrawer(null); });

// ── Filter pills ──────────────────────────────────────────────────────────────

document.querySelectorAll('.filter-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    state.filter = pill.dataset.filter;
    document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    renderDestGrid();
  });
});

document.getElementById('searchDestinations').addEventListener('input', e => {
  state.search = e.target.value;
  renderDestGrid();
});

// ── SCHEDULE TAB ──────────────────────────────────────────────────────────────

function renderScheduleTab() {
  const schedule = state.policy?.schedule || {};

  // Timezone
  const tzSel = document.getElementById('companyTimezone');
  tzSel.innerHTML = TIMEZONES.map(tz =>
    `<option value="${tz}"${tz === (schedule.timezone || 'America/New_York') ? ' selected' : ''}>${tz.replace('_', ' ')}</option>`
  ).join('');

  // Weekly hours grid
  const grid = document.getElementById('companyDaysGrid');
  grid.innerHTML = DAYS.map(day => {
    const data    = schedule.weekly?.[day] || {};
    const enabled = data.enabled !== undefined ? data.enabled : (day !== 'sat' && day !== 'sun');
    const open    = data.open  || '08:00';
    const close   = data.close || '17:00';
    return `
      <div class="day-row${enabled ? ' day-enabled' : ''}" data-day="${day}">
        <span class="day-name">${DAY_LABELS[day]}</span>
        <label class="toggle">
          <input type="checkbox" class="day-toggle" ${enabled ? 'checked' : ''} onchange="
            const row = this.closest('[data-day]');
            row.classList.toggle('day-enabled', this.checked);
            row.querySelectorAll('.time-input').forEach(i => i.disabled = !this.checked);
          " />
          <span class="toggle-slider"></span>
        </label>
        <div class="day-times">
          <input type="time" class="time-input" value="${open}"  ${enabled ? '' : 'disabled'} />
          <span class="time-sep">–</span>
          <input type="time" class="time-input" value="${close}" ${enabled ? '' : 'disabled'} />
          ${enabled ? '' : '<span class="day-closed-label">Closed</span>'}
        </div>
      </div>
    `;
  }).join('');

  // Emergency override
  const eo = state.policy?.emergencyOverride || {};
  document.getElementById('emergencyToggle').checked  = eo.active || false;
  document.getElementById('emergencyToggle2').checked = eo.active || false;
  document.getElementById('emergencyMessage').value   = eo.message || '';
  document.getElementById('emergencyForwardTo').value = eo.forwardTo || '';

  // Holidays
  renderHolidays();
}

function collectCompanySchedule() {
  const timezone = document.getElementById('companyTimezone').value;
  const weekly   = {};
  DAYS.forEach(day => {
    const row     = document.querySelector(`#companyDaysGrid [data-day="${day}"]`);
    if (!row) return;
    const enabled = row.querySelector('.day-toggle')?.checked || false;
    const times   = row.querySelectorAll('.time-input');
    weekly[day] = { enabled, open: times[0]?.value || '08:00', close: times[1]?.value || '17:00' };
  });
  return { timezone, weekly };
}

document.getElementById('btnSaveSchedule').addEventListener('click', async () => {
  const schedule = collectCompanySchedule();
  try {
    const result = await api('PATCH', '/policy', { schedule });
    state.policy = result.policy;
    toast('Business hours saved');
  } catch (err) {
    toast('Failed to save schedule: ' + err.message, 'error');
  }
});

// ── Holidays ──────────────────────────────────────────────────────────────────

let _holidays = [];

function renderHolidays() {
  _holidays = [...(state.policy?.schedule?.holidays || [])];
  const tbody = document.getElementById('holidaysTbody');
  const empty = document.getElementById('holidaysEmpty');

  if (!_holidays.length) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  tbody.innerHTML = _holidays.map((h, i) => `
    <tr>
      <td class="font-mono">${h.date}</td>
      <td>${escHtml(h.name || '—')}</td>
      <td><span class="badge ${h.type === 'closed' ? 'badge-offline' : 'badge-warm'}">${h.type === 'closed' ? 'Closed' : 'Custom Hours'}</span></td>
      <td>${h.type === 'custom' ? `${h.open} – ${h.close}` : '—'}</td>
      <td style="text-align:right;">
        <button class="btn btn-ghost btn-sm" onclick="removeHoliday(${i})" title="Remove">✕</button>
      </td>
    </tr>
  `).join('');
}

window.removeHoliday = function (idx) {
  _holidays.splice(idx, 1);
  renderHolidays();
};

document.getElementById('btnAddHoliday').addEventListener('click', () => {
  document.getElementById('holidayDate').value  = '';
  document.getElementById('holidayName').value  = '';
  document.getElementById('holidayType').value  = 'closed';
  document.getElementById('holidayHoursRow').classList.add('hidden');
  document.getElementById('holidayModal').classList.add('open');
});

document.getElementById('holidayType').addEventListener('change', function () {
  document.getElementById('holidayHoursRow').classList.toggle('hidden', this.value !== 'custom');
});

document.getElementById('btnHolidayCancel').addEventListener('click', () => {
  document.getElementById('holidayModal').classList.remove('open');
});

document.getElementById('btnHolidaySave').addEventListener('click', () => {
  const date = document.getElementById('holidayDate').value;
  if (!date) { toast('Please select a date', 'error'); return; }
  const h = {
    date,
    name:  document.getElementById('holidayName').value.trim(),
    type:  document.getElementById('holidayType').value,
    open:  document.getElementById('holidayOpen').value  || '08:00',
    close: document.getElementById('holidayClose').value || '12:00'
  };
  _holidays.push(h);
  _holidays.sort((a, b) => a.date.localeCompare(b.date));
  renderHolidays();
  document.getElementById('holidayModal').classList.remove('open');
});

document.getElementById('btnSaveHolidays').addEventListener('click', async () => {
  try {
    const schedule = collectCompanySchedule();
    schedule.holidays = _holidays;
    const result = await api('PATCH', '/policy', { schedule });
    state.policy = result.policy;
    toast('Holidays saved');
  } catch (err) {
    toast('Failed to save holidays: ' + err.message, 'error');
  }
});

// ── Emergency override ────────────────────────────────────────────────────────

function updateEmergencyBanner() {
  const active = state.policy?.emergencyOverride?.active || false;
  document.getElementById('emergencyBanner').classList.toggle('active', active);
  document.getElementById('emergencyToggleGroup').classList.toggle('active', active);
}

async function handleEmergencyToggle(active) {
  const message   = document.getElementById('emergencyMessage').value.trim();
  const forwardTo = document.getElementById('emergencyForwardTo').value.trim();
  try {
    const result = await api('POST', '/policy/emergency', { active, message: message || undefined, forwardTo: forwardTo || undefined });
    state.policy.emergencyOverride = { ...state.policy.emergencyOverride, active };
    updateEmergencyBanner();
    document.getElementById('emergencyToggle').checked  = active;
    document.getElementById('emergencyToggle2').checked = active;
    toast(active ? '🚨 Emergency override ACTIVATED' : '✅ Emergency override deactivated', active ? 'warning' : 'success');
  } catch (err) {
    toast('Failed to toggle emergency override: ' + err.message, 'error');
    document.getElementById('emergencyToggle').checked  = !active;
    document.getElementById('emergencyToggle2').checked = !active;
  }
}

document.getElementById('emergencyToggle').addEventListener('change',  e => handleEmergencyToggle(e.target.checked));
document.getElementById('emergencyToggle2').addEventListener('change', e => handleEmergencyToggle(e.target.checked));
document.getElementById('emergencyToggleGroup').addEventListener('click', e => {
  if (e.target.tagName === 'INPUT') return;
  const current = document.getElementById('emergencyToggle').checked;
  handleEmergencyToggle(!current);
});

// ── Char counters ─────────────────────────────────────────────────────────────

function bindCharCounter(textareaId, counterId) {
  const ta = document.getElementById(textareaId);
  const ct = document.getElementById(counterId);
  if (!ta || !ct) return;
  const update = () => { ct.textContent = ta.value.length; };
  ta.addEventListener('input', update);
  update();
}

bindCharCounter('emergencyMessage',     'emergencyMsgCount');
bindCharCounter('telemarkerMessage',    'telemarkerMsgCount');
bindCharCounter('blockedMessage',       'blockedMsgCount');
bindCharCounter('directoryProtocol',   'protocolCount');
bindCharCounter('defaultOverflowMessage', 'overflowMsgCount');

// ── SCREENING TAB ─────────────────────────────────────────────────────────────

function renderScreeningTab() {
  const screening = state.policy?.callerScreening || {};

  // VIP list
  renderPhoneList('vipList', 'vipEmpty', 'vipCount', screening.vipList || [], 'vip');
  // Blocklist
  renderPhoneList('blockList', 'blockEmpty', 'blockCount', screening.blocklist || [], 'block');

  // Telemarketer policy
  const action = screening.telemarkerAction || 'message';
  document.querySelectorAll('#telemarkerActionOptions .overflow-option').forEach(opt => {
    const matches = opt.querySelector('input').value === action;
    opt.classList.toggle('selected', matches);
    if (matches) opt.querySelector('input').checked = true;
  });
  document.getElementById('telemarkerMessage').value = screening.telemarkerMessage || '';
  document.getElementById('blockAnonymous').checked  = screening.blockAnonymous || false;
  document.getElementById('blockedMessage').value    = screening.blockedMessage || '';
  updateTabCounts();
}

function renderPhoneList(listId, emptyId, countId, phones, listType) {
  const list  = document.getElementById(listId);
  const empty = document.getElementById(emptyId);
  const count = document.getElementById(countId);

  count.textContent = phones.length;

  if (!phones.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  list.innerHTML = phones.map(p => `
    <li class="phone-list-item">
      <span class="phone-list-item-num">${escHtml(p)}</span>
      <button class="btn btn-ghost btn-sm" onclick="removePhone('${listType}','${escHtml(p)}')" title="Remove">✕</button>
    </li>
  `).join('');
}

window.removePhone = async function (listType, phone) {
  const path   = listType === 'vip' ? '/policy/vip' : '/policy/blocklist';
  const field  = listType === 'vip' ? 'vipList' : 'blocklist';
  try {
    const result = await api('POST', path, { action: 'remove', phoneNumber: phone });
    if (!state.policy.callerScreening) state.policy.callerScreening = {};
    state.policy.callerScreening[field] = listType === 'vip' ? result.vipList : result.blocklist;
    renderScreeningTab();
    toast('Removed');
  } catch (err) {
    toast('Failed to remove: ' + err.message, 'error');
  }
};

async function addPhone(listType) {
  const inputId = listType === 'vip' ? 'vipInput' : 'blockInput';
  const path    = listType === 'vip' ? '/policy/vip' : '/policy/blocklist';
  const field   = listType === 'vip' ? 'vipList' : 'blocklist';
  const phone   = document.getElementById(inputId).value.trim();
  if (!phone) return;
  try {
    const result = await api('POST', path, { action: 'add', phoneNumber: phone });
    if (!state.policy.callerScreening) state.policy.callerScreening = {};
    state.policy.callerScreening[field] = listType === 'vip' ? result.vipList : result.blocklist;
    document.getElementById(inputId).value = '';
    renderScreeningTab();
    toast(listType === 'vip' ? '⭐ Added to VIP list' : '🚫 Number blocked');
  } catch (err) {
    toast('Failed to add: ' + err.message, 'error');
  }
}

document.getElementById('btnAddVip').addEventListener('click', () => addPhone('vip'));
document.getElementById('btnAddBlock').addEventListener('click', () => addPhone('block'));

document.getElementById('vipInput').addEventListener('keydown', e => { if (e.key === 'Enter') addPhone('vip'); });
document.getElementById('blockInput').addEventListener('keydown', e => { if (e.key === 'Enter') addPhone('block'); });

document.getElementById('btnSaveScreeningPolicy').addEventListener('click', async () => {
  const action  = document.querySelector('input[name="telemarkerAction"]:checked')?.value || 'message';
  const message = document.getElementById('telemarkerMessage').value.trim();
  const blockAnon = document.getElementById('blockAnonymous').checked;
  try {
    const result = await api('PATCH', '/policy', {
      callerScreening: {
        ...(state.policy?.callerScreening || {}),
        telemarkerAction:  action,
        telemarkerMessage: message,
        blockAnonymous:    blockAnon
      }
    });
    state.policy = result.policy;
    toast('Telemarketer policy saved');
  } catch (err) {
    toast('Save failed: ' + err.message, 'error');
  }
});

document.getElementById('btnSaveBlockedMsg').addEventListener('click', async () => {
  const msg = document.getElementById('blockedMessage').value.trim();
  try {
    const result = await api('PATCH', '/policy', {
      callerScreening: { ...(state.policy?.callerScreening || {}), blockedMessage: msg }
    });
    state.policy = result.policy;
    toast('Blocked caller message saved');
  } catch (err) {
    toast('Save failed: ' + err.message, 'error');
  }
});

// ── PROTOCOL TAB ──────────────────────────────────────────────────────────────

function renderPolicyToUI() {
  if (!state.policy) return;

  // Directory protocol
  document.getElementById('directoryProtocol').value   = state.policy.directoryProtocol || '';
  document.getElementById('announceTransferEnabled').checked = state.policy.announceTransfer?.enabled !== false;
  document.getElementById('announceTemplate').value    = state.policy.announceTransfer?.template || '';
  document.getElementById('announceTemplateWrap').style.display =
    state.policy.announceTransfer?.enabled !== false ? '' : 'none';

  // Default transfer mode
  const dtm = state.policy.defaultTransferMode || 'warm';
  document.querySelectorAll('#defaultTransferModeCards .transfer-mode-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.mode === dtm);
  });

  // AI context
  document.getElementById('sendCallerSummaryDefault').checked    = state.policy.sendCallerSummaryDefault !== false;
  document.getElementById('includeDiscoveryNotesDefault').checked = state.policy.includeDiscoveryNotesDefault !== false;

  // Default overflow
  const doa = state.policy.defaultOverflowAction || 'voicemail';
  document.querySelectorAll('#defaultOverflowOptions .overflow-option').forEach(opt => {
    const matches = opt.querySelector('input').value === doa;
    opt.classList.toggle('selected', matches);
    if (matches) opt.querySelector('input').checked = true;
  });
  document.getElementById('defaultOverflowMessage').value = state.policy.defaultOverflowMessage || '';

  // Char counters update
  ['emergencyMessage','telemarkerMessage','blockedMessage','directoryProtocol','defaultOverflowMessage']
    .forEach(id => {
      const ta = document.getElementById(id);
      if (ta) ta.dispatchEvent(new Event('input'));
    });
}

// Announce toggle
document.getElementById('announceTransferEnabled').addEventListener('change', function () {
  document.getElementById('announceTemplateWrap').style.display = this.checked ? '' : 'none';
});

// Default transfer mode cards
document.querySelectorAll('#defaultTransferModeCards .transfer-mode-card').forEach(c => {
  c.addEventListener('click', () => {
    document.querySelectorAll('#defaultTransferModeCards .transfer-mode-card')
      .forEach(x => x.classList.remove('selected'));
    c.classList.add('selected');
  });
});

async function saveProtocolSettings() {
  const defaultTransferMode = document.querySelector('#defaultTransferModeCards .transfer-mode-card.selected')?.dataset.mode || 'warm';
  const defaultOverflowAction = document.querySelector('input[name="defaultOverflow"]:checked')?.value || 'voicemail';

  const body = {
    directoryProtocol:    document.getElementById('directoryProtocol').value.trim(),
    defaultTransferMode,
    defaultOverflowAction,
    defaultOverflowMessage: document.getElementById('defaultOverflowMessage').value.trim(),
    sendCallerSummaryDefault:     document.getElementById('sendCallerSummaryDefault').checked,
    includeDiscoveryNotesDefault: document.getElementById('includeDiscoveryNotesDefault').checked,
    announceTransfer: {
      enabled:  document.getElementById('announceTransferEnabled').checked,
      template: document.getElementById('announceTemplate').value.trim()
    }
  };

  const btn = document.getElementById('btnSaveProtocol');
  btn.disabled = true; btn.textContent = 'Saving…';

  try {
    const result = await api('PATCH', '/policy', body);
    state.policy = result.policy;
    toast('Protocol settings saved');
  } catch (err) {
    toast('Save failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save Changes`;
  }
}

document.getElementById('btnSaveProtocol').addEventListener('click', saveProtocolSettings);
document.getElementById('btnSaveProtocol2').addEventListener('click', saveProtocolSettings);

// ── Back button ───────────────────────────────────────────────────────────────

document.getElementById('btnBack').addEventListener('click', e => {
  e.preventDefault();
  window.location.href = `/agent-console/index.html?companyId=${encodeURIComponent(state.companyId)}`;
});

// ── INIT ──────────────────────────────────────────────────────────────────────

(function init() {
  const params     = new URLSearchParams(window.location.search);
  state.companyId  = params.get('companyId') || '';

  if (!state.companyId) {
    document.getElementById('headerCompanyName').textContent = 'No company selected';
    toast('No companyId found in URL', 'error');
    return;
  }

  initTabs();
  loadCompanyName();
  loadAll();
})();
