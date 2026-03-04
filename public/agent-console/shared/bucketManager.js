/**
 * ============================================================================
 * BUCKET MANAGER — Shared UI controller for Trigger Buckets
 * ============================================================================
 */

(function() {
  'use strict';

  const CONFIG = {
    API_BASE: '/api/agent-console'
  };

  const state = {
    companyId: null,
    buckets: [],
    cacheInfo: null,
    onBucketsUpdated: null,
    showToast: null,
    apiFetch: null,
    initialized: false
  };

  const DOM = {
    bucketNameInput: document.getElementById('bucket-name-input'),
    bucketKeywordsInput: document.getElementById('bucket-keywords-input'),
    btnAddBucket: document.getElementById('btn-add-bucket'),
    bucketList: document.getElementById('bucket-list'),
    bucketEmpty: document.getElementById('bucket-empty')
  };

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function parseKeywords(input) {
    if (Array.isArray(input)) return input;
    if (typeof input !== 'string') return [];
    return input
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);
  }

  function showToast(type, title, message) {
    if (typeof state.showToast === 'function') {
      state.showToast(type, title, message);
      return;
    }
    if (type === 'error') {
      console.error(`[BucketManager] ${title}:`, message);
    } else {
      console.log(`[BucketManager] ${title}:`, message);
    }
  }

  async function apiFetch(url, options = {}) {
    if (typeof state.apiFetch === 'function') {
      return state.apiFetch(url, options);
    }
    if (!window.AgentConsoleAuth || typeof AgentConsoleAuth.apiFetch !== 'function') {
      throw new Error('AgentConsoleAuth not available');
    }
    return AgentConsoleAuth.apiFetch(url, options);
  }

  async function loadBuckets() {
    if (!state.companyId) return;
    const response = await apiFetch(`${CONFIG.API_BASE}/${state.companyId}/trigger-buckets`);
    const payload = response?.data || response;
    state.buckets = payload?.buckets || [];
    state.cacheInfo = payload?.cacheInfo || null;
    renderBuckets();
    if (typeof state.onBucketsUpdated === 'function') {
      state.onBucketsUpdated(state.buckets, state.cacheInfo);
    }
  }

  function renderBuckets() {
    if (!DOM.bucketList) return;
    DOM.bucketList.innerHTML = '';

    if (!state.buckets.length) {
      if (DOM.bucketEmpty) DOM.bucketEmpty.style.display = 'block';
      return;
    }
    if (DOM.bucketEmpty) DOM.bucketEmpty.style.display = 'none';

    DOM.bucketList.innerHTML = state.buckets.map(bucket => {
      const keywords = (bucket.keywords || []).join(', ');
      return `
        <div class="bucket-row" data-bucket-id="${escapeHtml(bucket.id)}" data-bucket-key="${escapeHtml(bucket.key)}">
          <div>
            <input type="text" class="form-input bucket-name" value="${escapeHtml(bucket.name || '')}">
            <div class="bucket-key">Key: ${escapeHtml(bucket.key)}</div>
          </div>
          <div>
            <input type="text" class="form-input bucket-keywords" value="${escapeHtml(keywords)}" placeholder="keywords, phrases">
          </div>
          <div class="bucket-actions">
            <button class="btn btn-secondary btn-sm bucket-save">Save</button>
            <button class="btn btn-danger btn-sm bucket-delete">Delete</button>
          </div>
        </div>
      `;
    }).join('');

    DOM.bucketList.querySelectorAll('.bucket-save').forEach(btn => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('.bucket-row');
        if (row) await handleSaveBucket(row);
      });
    });

    DOM.bucketList.querySelectorAll('.bucket-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('.bucket-row');
        if (row) await handleDeleteBucket(row);
      });
    });
  }

  async function handleAddBucket() {
    if (!DOM.bucketNameInput || !DOM.bucketKeywordsInput || !DOM.btnAddBucket) return;
    const name = DOM.bucketNameInput.value.trim();
    if (!name) {
      showToast('error', 'Missing Name', 'Bucket name is required.');
      return;
    }
    const keywords = parseKeywords(DOM.bucketKeywordsInput.value);

    DOM.btnAddBucket.disabled = true;
    DOM.btnAddBucket.textContent = 'Adding...';
    try {
      await apiFetch(`${CONFIG.API_BASE}/${state.companyId}/trigger-buckets`, {
        method: 'POST',
        body: { name, keywords }
      });
      DOM.bucketNameInput.value = '';
      DOM.bucketKeywordsInput.value = '';
      showToast('success', 'Bucket Added', `"${name}" is now available.`);
      await loadBuckets();
    } catch (error) {
      showToast('error', 'Add Failed', error.message || 'Could not add bucket.');
    } finally {
      DOM.btnAddBucket.disabled = false;
      DOM.btnAddBucket.textContent = 'Add Bucket';
    }
  }

  async function handleSaveBucket(row) {
    const bucketId = row.dataset.bucketId;
    const name = row.querySelector('.bucket-name')?.value?.trim();
    const keywordsInput = row.querySelector('.bucket-keywords')?.value || '';

    if (!bucketId || !name) {
      showToast('error', 'Validation Error', 'Bucket name is required.');
      return;
    }

    const keywords = parseKeywords(keywordsInput);
    const saveBtn = row.querySelector('.bucket-save');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
    }

    try {
      await apiFetch(`${CONFIG.API_BASE}/${state.companyId}/trigger-buckets/${bucketId}`, {
        method: 'PATCH',
        body: { name, keywords }
      });
      showToast('success', 'Bucket Saved', `"${name}" updated successfully.`);
      await loadBuckets();
    } catch (error) {
      showToast('error', 'Save Failed', error.message || 'Could not save bucket.');
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
      }
    }
  }

  async function handleDeleteBucket(row) {
    const bucketId = row.dataset.bucketId;
    const bucketKey = row.dataset.bucketKey;
    if (!bucketId) return;

    const confirmDelete = window.confirm(
      `Delete this bucket?\n\nKey: ${bucketKey}\nThis will unassign any triggers using it.`
    );
    if (!confirmDelete) return;

    const deleteBtn = row.querySelector('.bucket-delete');
    if (deleteBtn) {
      deleteBtn.disabled = true;
      deleteBtn.textContent = 'Deleting...';
    }

    try {
      await apiFetch(`${CONFIG.API_BASE}/${state.companyId}/trigger-buckets/${bucketId}`, {
        method: 'DELETE'
      });
      showToast('success', 'Bucket Deleted', 'Bucket removed and triggers unassigned.');
      await loadBuckets();
    } catch (error) {
      showToast('error', 'Delete Failed', error.message || 'Could not delete bucket.');
    } finally {
      if (deleteBtn) {
        deleteBtn.disabled = false;
        deleteBtn.textContent = 'Delete';
      }
    }
  }

  function init(options = {}) {
    if (state.initialized) return;
    state.companyId = options.companyId || null;
    state.onBucketsUpdated = options.onBucketsUpdated || null;
    state.showToast = options.showToast || null;
    state.initialized = true;

    if (DOM.btnAddBucket) {
      DOM.btnAddBucket.addEventListener('click', handleAddBucket);
    }
    if (DOM.bucketNameInput) {
      DOM.bucketNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleAddBucket();
      });
    }
    if (DOM.bucketKeywordsInput) {
      DOM.bucketKeywordsInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleAddBucket();
      });
    }

    loadBuckets().catch(error => {
      const detailedMessage = error?.data?.error || error?.data?.message || error?.message || 'Could not load buckets.';
      showToast('error', 'Bucket Load Failed', detailedMessage);
    });
  }

  window.BucketManager = {
    init,
    reload: loadBuckets
  };
})();
