/**
 * ════════════════════════════════════════════════════════════════════════════════
 * AGENT CONSOLE - GOOGLE CALENDAR PAGE
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * Purpose: Connect, verify, and test Google Calendar integration for Booking Logic.
 * 
 * NO legacy UI code. Uses only Agent Console API endpoints.
 * 
 * ════════════════════════════════════════════════════════════════════════════════
 */

// ════════════════════════════════════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════════════════════════════════════

let companyId = null;
let calendarStatus = null;
let calendarList = [];

// ════════════════════════════════════════════════════════════════════════════════
// DOM ELEMENTS
// ════════════════════════════════════════════════════════════════════════════════

const els = {};

function initElements() {
  els.headerCompanyName = document.getElementById('header-company-name');
  els.headerCompanyId = document.getElementById('header-company-id');
  els.badgeConnectionStatus = document.getElementById('badge-connection-status');
  
  els.stateConnected = document.getElementById('state-connected');
  els.stateDisconnected = document.getElementById('state-disconnected');
  els.stateError = document.getElementById('state-error');
  
  els.connectedEmail = document.getElementById('connected-email');
  els.connectedAt = document.getElementById('connected-at');
  els.connectedCalendar = document.getElementById('connected-calendar');
  els.errorMessage = document.getElementById('error-message');
  
  els.cardCalendarSelection = document.getElementById('card-calendar-selection');
  els.selectCalendar = document.getElementById('select-calendar');
  
  els.inputStartDate = document.getElementById('input-start-date');
  els.inputDuration = document.getElementById('input-duration');
  els.availabilityStatusDot = document.getElementById('availability-status-dot');
  els.availabilityResults = document.getElementById('availability-results');
  els.availabilityJson = document.getElementById('availability-json');
  
  els.btnBack = document.getElementById('btn-back');
  els.btnDownloadTruth = document.getElementById('btn-download-truth');
  els.btnConnect = document.getElementById('btn-connect');
  els.btnDisconnect = document.getElementById('btn-disconnect');
  els.btnTestConnection = document.getElementById('btn-test-connection');
  els.btnRetry = document.getElementById('btn-retry');
  els.btnSaveCalendar = document.getElementById('btn-save-calendar');
  els.btnPreviewAvailability = document.getElementById('btn-preview-availability');
  
  els.toastContainer = document.getElementById('toast-container');
}

// ════════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ════════════════════════════════════════════════════════════════════════════════

function getCompanyIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('companyId');
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  els.toastContainer.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.add('toast-fade-out');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function formatDate(dateString) {
  if (!dateString) return '—';
  const date = new Date(dateString);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatTimeOption(timeOption) {
  const start = new Date(timeOption.start);
  const end = new Date(timeOption.end);
  
  const dateStr = start.toLocaleDateString('en-US', { 
    weekday: 'short', 
    month: 'short', 
    day: 'numeric' 
  });
  
  const startStr = start.toLocaleTimeString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit' 
  });
  
  const endStr = end.toLocaleTimeString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit' 
  });
  
  return `${dateStr}, ${startStr} - ${endStr}`;
}

function getAuthHeaders() {
  const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

async function apiFetch(endpoint, options = {}) {
  const url = `/api/agent-console/${companyId}${endpoint}`;
  
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...options.headers
    },
    ...options
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || error.message || 'Request failed');
  }
  
  return response.json();
}

// ════════════════════════════════════════════════════════════════════════════════
// UI STATE MANAGEMENT
// ════════════════════════════════════════════════════════════════════════════════

function showState(state, errorMsg = null) {
  els.stateConnected.classList.add('hidden');
  els.stateDisconnected.classList.add('hidden');
  els.stateError.classList.add('hidden');
  els.cardCalendarSelection.classList.add('hidden');
  
  switch (state) {
    case 'connected':
      els.stateConnected.classList.remove('hidden');
      els.cardCalendarSelection.classList.remove('hidden');
      els.badgeConnectionStatus.textContent = 'Connected';
      els.badgeConnectionStatus.className = 'badge badge-success';
      els.availabilityStatusDot.className = 'status-dot status-dot-success';
      break;
      
    case 'disconnected':
      els.stateDisconnected.classList.remove('hidden');
      els.badgeConnectionStatus.textContent = 'Not Connected';
      els.badgeConnectionStatus.className = 'badge badge-warning';
      els.availabilityStatusDot.className = 'status-dot status-dot-warning';
      break;
      
    case 'error':
      els.stateError.classList.remove('hidden');
      els.errorMessage.textContent = errorMsg || 'Unknown error';
      els.badgeConnectionStatus.textContent = 'Error';
      els.badgeConnectionStatus.className = 'badge badge-error';
      els.availabilityStatusDot.className = 'status-dot status-dot-error';
      break;
      
    case 'loading':
      els.badgeConnectionStatus.textContent = 'Checking...';
      els.badgeConnectionStatus.className = 'badge';
      break;
  }
}

function updateConnectedInfo(status) {
  els.connectedEmail.textContent = status.email || '—';
  els.connectedAt.textContent = formatDate(status.connectedAt);
  els.connectedCalendar.textContent = status.calendarName || status.calendarId || 'primary';
}

function populateCalendarDropdown(calendars, selectedId) {
  els.selectCalendar.innerHTML = '';
  
  if (!calendars || calendars.length === 0) {
    els.selectCalendar.innerHTML = '<option value="">No calendars found</option>';
    return;
  }
  
  calendars.forEach(cal => {
    const option = document.createElement('option');
    option.value = cal.id;
    option.textContent = cal.summary + (cal.primary ? ' (Primary)' : '');
    option.selected = cal.id === selectedId;
    els.selectCalendar.appendChild(option);
  });
}

function renderAvailabilityResults(timeOptions) {
  if (!timeOptions || timeOptions.length === 0) {
    els.availabilityResults.innerHTML = '<p class="text-muted text-sm">No available times found for this period.</p>';
    return;
  }
  
  const html = timeOptions.slice(0, 10).map((opt, i) => `
    <div class="flow-step">
      <div class="flow-step-number">${i + 1}</div>
      <div class="flow-step-content">
        <div class="font-medium">${formatTimeOption(opt)}</div>
      </div>
    </div>
  `).join('');
  
  els.availabilityResults.innerHTML = html;
  
  if (timeOptions.length > 10) {
    els.availabilityResults.innerHTML += `
      <p class="text-muted text-sm mt-2">+ ${timeOptions.length - 10} more time options</p>
    `;
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// API CALLS
// ════════════════════════════════════════════════════════════════════════════════

async function loadCalendarStatus() {
  showState('loading');
  
  try {
    const status = await apiFetch('/calendar/status');
    calendarStatus = status;
    
    if (status.connected) {
      showState('connected');
      updateConnectedInfo(status);
      await loadCalendarList();
    } else {
      showState('disconnected');
    }
  } catch (err) {
    console.error('Failed to load calendar status:', err);
    showState('error', err.message);
  }
}

async function loadCalendarList() {
  try {
    const data = await apiFetch('/calendar/calendars');
    calendarList = data.calendars || [];
    populateCalendarDropdown(calendarList, calendarStatus?.calendarId);
  } catch (err) {
    console.error('Failed to load calendars:', err);
    showToast('Failed to load calendar list', 'error');
  }
}

async function connectCalendar() {
  els.btnConnect.disabled = true;
  els.btnConnect.textContent = 'Connecting...';
  
  try {
    const data = await apiFetch('/calendar/connect/start', { method: 'POST' });
    
    if (data.authUrl) {
      window.location.href = data.authUrl;
    } else {
      throw new Error('No auth URL returned');
    }
  } catch (err) {
    console.error('Failed to start connection:', err);
    showToast('Failed to start connection: ' + err.message, 'error');
    els.btnConnect.disabled = false;
    els.btnConnect.textContent = 'Connect Google Calendar';
  }
}

async function disconnectCalendar() {
  if (!confirm('Are you sure you want to disconnect Google Calendar? Booking Logic will fall back to preference capture.')) {
    return;
  }
  
  els.btnDisconnect.disabled = true;
  els.btnDisconnect.textContent = 'Disconnecting...';
  
  try {
    await apiFetch('/calendar/disconnect', { method: 'POST' });
    showToast('Calendar disconnected', 'success');
    calendarStatus = null;
    calendarList = [];
    showState('disconnected');
  } catch (err) {
    console.error('Failed to disconnect:', err);
    showToast('Failed to disconnect: ' + err.message, 'error');
  } finally {
    els.btnDisconnect.disabled = false;
    els.btnDisconnect.textContent = 'Disconnect';
  }
}

async function testConnection() {
  els.btnTestConnection.disabled = true;
  const originalText = els.btnTestConnection.innerHTML;
  els.btnTestConnection.innerHTML = '<span>Testing...</span>';
  
  try {
    const result = await apiFetch('/calendar/test');
    
    if (result.success) {
      showToast('Connection verified successfully', 'success');
    } else {
      showToast('Connection test failed: ' + (result.error || 'Unknown error'), 'error');
    }
  } catch (err) {
    console.error('Connection test failed:', err);
    showToast('Connection test failed: ' + err.message, 'error');
  } finally {
    els.btnTestConnection.disabled = false;
    els.btnTestConnection.innerHTML = originalText;
  }
}

async function saveCalendarSelection() {
  const calendarId = els.selectCalendar.value;
  
  if (!calendarId) {
    showToast('Please select a calendar', 'error');
    return;
  }
  
  els.btnSaveCalendar.disabled = true;
  els.btnSaveCalendar.textContent = 'Saving...';
  
  try {
    await apiFetch('/calendar/select', {
      method: 'POST',
      body: JSON.stringify({ calendarId })
    });
    
    const selectedCal = calendarList.find(c => c.id === calendarId);
    if (selectedCal) {
      calendarStatus.calendarId = calendarId;
      calendarStatus.calendarName = selectedCal.summary;
      els.connectedCalendar.textContent = selectedCal.summary;
    }
    
    showToast('Calendar saved', 'success');
  } catch (err) {
    console.error('Failed to save calendar:', err);
    showToast('Failed to save calendar: ' + err.message, 'error');
  } finally {
    els.btnSaveCalendar.disabled = false;
    els.btnSaveCalendar.textContent = 'Save Selection';
  }
}

async function previewAvailability() {
  if (!calendarStatus?.connected) {
    showToast('Connect calendar first', 'error');
    return;
  }
  
  const startDate = els.inputStartDate.value;
  const duration = parseInt(els.inputDuration.value, 10);
  
  if (!startDate) {
    showToast('Select a start date', 'error');
    return;
  }
  
  els.btnPreviewAvailability.disabled = true;
  els.btnPreviewAvailability.textContent = 'Loading...';
  els.availabilityResults.innerHTML = '<p class="text-muted text-sm">Checking availability...</p>';
  
  try {
    const result = await apiFetch('/calendar/test-availability', {
      method: 'POST',
      body: JSON.stringify({ startDate, durationMinutes: duration })
    });
    
    els.availabilityJson.textContent = JSON.stringify(result, null, 2);
    renderAvailabilityResults(result.availableTimeOptions);
    
  } catch (err) {
    console.error('Failed to get availability:', err);
    els.availabilityJson.textContent = JSON.stringify({ error: err.message }, null, 2);
    els.availabilityResults.innerHTML = `<p class="text-muted text-sm text-error">Error: ${err.message}</p>`;
  } finally {
    els.btnPreviewAvailability.disabled = false;
    els.btnPreviewAvailability.textContent = 'Preview Available Time Options';
  }
}

async function downloadTruthJson() {
  els.btnDownloadTruth.disabled = true;
  
  try {
    const data = await apiFetch('/truth');
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    
    const now = new Date();
    const timestamp = now.toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
    a.download = `truth_${companyId}_${timestamp}.json`;
    
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showToast('Truth JSON downloaded', 'success');
  } catch (err) {
    console.error('Failed to download truth:', err);
    showToast('Failed to download: ' + err.message, 'error');
  } finally {
    els.btnDownloadTruth.disabled = false;
  }
}

async function loadCompanyInfo() {
  try {
    const data = await apiFetch('/truth');
    
    if (data.companyProfile) {
      els.headerCompanyName.textContent = data.companyProfile.businessName || 'Unknown Company';
    }
    els.headerCompanyId.textContent = companyId;
  } catch (err) {
    console.error('Failed to load company info:', err);
    els.headerCompanyName.textContent = 'Error loading';
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// EVENT HANDLERS
// ════════════════════════════════════════════════════════════════════════════════

function initEventHandlers() {
  els.btnBack.addEventListener('click', (e) => {
    e.preventDefault();
    window.location.href = `/agent-console/index.html?companyId=${encodeURIComponent(companyId)}`;
  });
  
  els.btnDownloadTruth.addEventListener('click', downloadTruthJson);
  els.btnConnect.addEventListener('click', connectCalendar);
  els.btnDisconnect.addEventListener('click', disconnectCalendar);
  els.btnTestConnection.addEventListener('click', testConnection);
  els.btnRetry.addEventListener('click', loadCalendarStatus);
  els.btnSaveCalendar.addEventListener('click', saveCalendarSelection);
  els.btnPreviewAvailability.addEventListener('click', previewAvailability);
  
  // Set default date to today
  const today = new Date().toISOString().split('T')[0];
  els.inputStartDate.value = today;
}

// ════════════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ════════════════════════════════════════════════════════════════════════════════

async function init() {
  companyId = getCompanyIdFromUrl();
  
  if (!companyId) {
    document.body.innerHTML = '<div style="padding: 2rem; text-align: center;"><h1>Missing companyId</h1><p>Add ?companyId=xxx to the URL</p></div>';
    return;
  }
  
  initElements();
  initEventHandlers();
  
  await Promise.all([
    loadCompanyInfo(),
    loadCalendarStatus()
  ]);
}

document.addEventListener('DOMContentLoaded', init);
