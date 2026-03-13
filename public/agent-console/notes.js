/**
 * Developer Notes — Enterprise Build Notepad
 * Frontend controller: tab management, section editing, rich text, auto-save
 */

(function () {
  'use strict';

  // ──────────────────────────────────────────────────────────────────────────
  // CONFIG & STATE
  // ──────────────────────────────────────────────────────────────────────────

  const TAB_COLORS = [
    '#6366F1', '#3B82F6', '#06B6D4', '#10B981',
    '#F59E0B', '#EF4444', '#EC4899', '#8B5CF6',
    '#14B8A6', '#F97316', '#64748B', '#84CC16'
  ];

  let state = {
    companyId: null,
    tabs: [],               // all tabs
    activeTabId: null,      // currently displayed tab
    activeSectionId: null,  // currently focused section
    dirty: false,
    saveTimer: null,
    saveStatus: 'saved'     // 'saved' | 'saving' | 'error'
  };

  // ──────────────────────────────────────────────────────────────────────────
  // UTILITIES
  // ──────────────────────────────────────────────────────────────────────────

  function uid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function stripHtml(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.textContent || '';
  }

  function getCompanyId() {
    return new URLSearchParams(window.location.search).get('companyId') || '';
  }

  function setBackLink() {
    const link = document.getElementById('back-link');
    if (link && state.companyId) {
      link.href = `/agent-console/?companyId=${encodeURIComponent(state.companyId)}`;
    }
  }

  function setSaveStatus(status, msg) {
    state.saveStatus = status;
    const el = document.getElementById('save-status');
    if (!el) return;
    el.className = `notes-save-status ${status}`;
    const labels = {
      saving: '⏳ Saving...',
      saved:  '✓ All changes saved',
      error:  '⚠ Save failed — retrying...'
    };
    el.textContent = msg || labels[status] || '';
  }

  function showToast(msg, type = 'info') {
    const t = document.createElement('div');
    t.className = `notes-toast ${type}`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // API
  // ──────────────────────────────────────────────────────────────────────────

  async function apiLoad() {
    const res = await fetch(`/api/developer-notes/${encodeURIComponent(state.companyId)}`);
    if (!res.ok) throw new Error(`Load failed: ${res.status}`);
    return res.json();
  }

  async function apiSave(payload) {
    const res = await fetch(`/api/developer-notes/${encodeURIComponent(state.companyId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`Save failed: ${res.status}`);
    return res.json();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // AUTO-SAVE
  // ──────────────────────────────────────────────────────────────────────────

  function markDirty() {
    state.dirty = true;
    setSaveStatus('saving');
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(flushSave, 1500);
  }

  async function flushSave() {
    if (!state.dirty) return;
    state.dirty = false;
    setSaveStatus('saving');
    try {
      await apiSave({ tabs: state.tabs, lastActiveTabId: state.activeTabId });
      setSaveStatus('saved');
    } catch (err) {
      state.dirty = true;
      setSaveStatus('error');
      console.error('[Notes] Save error:', err);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TAB MANAGEMENT
  // ──────────────────────────────────────────────────────────────────────────

  function getActiveTab() {
    return state.tabs.find(t => t.id === state.activeTabId) || null;
  }

  function createTab(title = 'New Notebook') {
    return {
      id: uid(),
      title,
      color: TAB_COLORS[state.tabs.length % TAB_COLORS.length],
      order: state.tabs.length,
      sections: []
    };
  }

  function addTab() {
    const tab = createTab();
    state.tabs.push(tab);
    state.activeTabId = tab.id;
    renderSidebar();
    renderEditor();
    // Focus title
    const titleInput = document.getElementById('tab-title-input');
    if (titleInput) { titleInput.focus(); titleInput.select(); }
    markDirty();
  }

  function deleteTab(tabId) {
    if (!confirm('Delete this notebook and all its sections? This cannot be undone.')) return;
    state.tabs = state.tabs.filter(t => t.id !== tabId);
    if (state.activeTabId === tabId) {
      state.activeTabId = state.tabs.length > 0 ? state.tabs[state.tabs.length - 1].id : null;
    }
    renderSidebar();
    renderEditor();
    markDirty();
  }

  function setActiveTab(tabId) {
    state.activeTabId = tabId;
    renderSidebar();
    renderEditor();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SECTION MANAGEMENT
  // ──────────────────────────────────────────────────────────────────────────

  function createSection(title = '') {
    return {
      id: uid(),
      title: title || '',
      content: '',
      collapsed: false,
      order: 0,
      tags: []
    };
  }

  function addSection() {
    const tab = getActiveTab();
    if (!tab) return;
    const sec = createSection();
    sec.order = tab.sections.length;
    tab.sections.push(sec);
    renderSections();
    // Focus the new section title
    setTimeout(() => {
      const input = document.querySelector(`[data-section-id="${sec.id}"] .section-title-input`);
      if (input) input.focus();
    }, 50);
    markDirty();
  }

  function deleteSection(secId) {
    const tab = getActiveTab();
    if (!tab) return;
    if (!confirm('Delete this section?')) return;
    tab.sections = tab.sections.filter(s => s.id !== secId);
    renderSections();
    markDirty();
  }

  function toggleCollapse(secId) {
    const tab = getActiveTab();
    if (!tab) return;
    const sec = tab.sections.find(s => s.id === secId);
    if (sec) {
      sec.collapsed = !sec.collapsed;
      const card = document.querySelector(`[data-section-id="${secId}"]`);
      if (card) card.classList.toggle('collapsed', sec.collapsed);
      markDirty();
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RENDERING — SIDEBAR
  // ──────────────────────────────────────────────────────────────────────────

  function renderSidebar() {
    const list = document.getElementById('tab-list');
    const countEl = document.getElementById('sidebar-tab-count');
    if (!list) return;

    if (state.tabs.length === 0) {
      list.innerHTML = '<p style="padding:0.75rem 1rem;font-size:12px;color:var(--text-muted);">No notebooks yet</p>';
      if (countEl) countEl.textContent = '0 notebooks';
      return;
    }

    if (countEl) countEl.textContent = `${state.tabs.length} notebook${state.tabs.length !== 1 ? 's' : ''}`;

    list.innerHTML = state.tabs.map(tab => `
      <div class="tab-item ${tab.id === state.activeTabId ? 'active' : ''}"
           data-tab-id="${tab.id}">
        <div class="tab-item-dot" style="background:${escHtml(tab.color)}"></div>
        <span class="tab-item-title">${escHtml(tab.title || 'Untitled')}</span>
        <span class="tab-item-count">${tab.sections.length}</span>
      </div>
    `).join('');

    list.querySelectorAll('.tab-item').forEach(el => {
      el.addEventListener('click', () => setActiveTab(el.dataset.tabId));
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RENDERING — EDITOR
  // ──────────────────────────────────────────────────────────────────────────

  function renderEditor() {
    const emptyState = document.getElementById('editor-empty-state');
    const tabEditor  = document.getElementById('tab-editor');
    if (!emptyState || !tabEditor) return;

    const tab = getActiveTab();
    if (!tab) {
      emptyState.style.display = 'flex';
      tabEditor.style.display  = 'none';
      return;
    }

    emptyState.style.display = 'none';
    tabEditor.style.display  = 'flex';

    // Color dot
    const dot = document.getElementById('tab-color-dot');
    if (dot) dot.style.background = tab.color;

    // Title
    const titleInput = document.getElementById('tab-title-input');
    if (titleInput) {
      titleInput.value = tab.title || '';
      titleInput.oninput = () => {
        tab.title = titleInput.value;
        // Update sidebar live
        const sidebarTitle = document.querySelector(`.tab-item[data-tab-id="${tab.id}"] .tab-item-title`);
        if (sidebarTitle) sidebarTitle.textContent = tab.title || 'Untitled';
        markDirty();
      };
    }

    // Section count
    updateSectionCount(tab);

    // Render sections
    renderSections();
  }

  function updateSectionCount(tab) {
    const el = document.getElementById('tab-section-count');
    if (el) el.textContent = `${(tab || getActiveTab())?.sections?.length ?? 0} section${(tab || getActiveTab())?.sections?.length !== 1 ? 's' : ''}`;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RENDERING — SECTIONS
  // ──────────────────────────────────────────────────────────────────────────

  function renderSections() {
    const container = document.getElementById('sections-container');
    if (!container) return;
    const tab = getActiveTab();
    if (!tab) { container.innerHTML = ''; return; }

    container.innerHTML = tab.sections.map(sec => buildSectionHtml(sec)).join('');

    // Wire up all section events
    container.querySelectorAll('.section-card').forEach(card => {
      const secId = card.dataset.sectionId;
      wireSection(card, secId);
    });

    updateSectionCount(tab);
  }

  function buildSectionHtml(sec) {
    const collapsedClass = sec.collapsed ? 'collapsed' : '';
    const tagsHtml = (sec.tags || []).map(tag =>
      `<span class="section-tag" data-tag="${escHtml(tag)}">${escHtml(tag)} ×</span>`
    ).join('');

    return `
      <div class="section-card ${collapsedClass}" data-section-id="${sec.id}">
        <!-- Section Header -->
        <div class="section-header">
          <span class="section-drag-handle" title="Drag to reorder">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <circle cx="4" cy="3" r="1" fill="currentColor"/>
              <circle cx="8" cy="3" r="1" fill="currentColor"/>
              <circle cx="4" cy="6" r="1" fill="currentColor"/>
              <circle cx="8" cy="6" r="1" fill="currentColor"/>
              <circle cx="4" cy="9" r="1" fill="currentColor"/>
              <circle cx="8" cy="9" r="1" fill="currentColor"/>
            </svg>
          </span>
          <button class="section-collapse-btn" title="Collapse/Expand">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 4L6 8L10 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <input type="text"
                 class="section-title-input"
                 value="${escHtml(sec.title)}"
                 placeholder="Section title...">
          <div class="section-header-actions">
            <button class="section-action-btn delete-btn" title="Delete section">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M1.5 3H10.5M4 3V2H8V3M3.5 3L4 10H8L8.5 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- Format Toolbar -->
        <div class="format-toolbar">
          <button class="fmt-btn fmt-btn-wide" data-cmd="formatBlock" data-arg="h1" title="Heading 1">H1</button>
          <button class="fmt-btn fmt-btn-wide" data-cmd="formatBlock" data-arg="h2" title="Heading 2">H2</button>
          <button class="fmt-btn fmt-btn-wide" data-cmd="formatBlock" data-arg="h3" title="Heading 3">H3</button>
          <div class="toolbar-divider"></div>
          <button class="fmt-btn" data-cmd="bold" title="Bold (Ctrl+B)"><b>B</b></button>
          <button class="fmt-btn" data-cmd="italic" title="Italic (Ctrl+I)"><i>I</i></button>
          <div class="toolbar-divider"></div>
          <button class="fmt-btn" data-cmd="insertUnorderedList" title="Bullet List">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="2.5" cy="4" r="1.2" fill="currentColor"/><path d="M5 4H12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="2.5" cy="7" r="1.2" fill="currentColor"/><path d="M5 7H12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="2.5" cy="10" r="1.2" fill="currentColor"/><path d="M5 10H12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
          </button>
          <button class="fmt-btn" data-cmd="insertOrderedList" title="Numbered List">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 3V5.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M1.5 5.5H2.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M5 4H12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M1.5 9H2.5L1.5 11H2.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 10H12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
          </button>
          <div class="toolbar-divider"></div>
          <button class="fmt-btn fmt-btn-wide" data-action="inline-code" title="Inline code">&lt;/&gt;</button>
          <button class="fmt-btn fmt-btn-wide" data-action="code-block" title="Code block">CODE</button>
          <button class="fmt-btn fmt-btn-wide" data-action="blockquote" title="Blockquote">❝</button>
          <div class="toolbar-divider"></div>
          <button class="fmt-btn fmt-btn-wide" data-cmd="insertHorizontalRule" title="Divider">—</button>
          <button class="fmt-btn fmt-btn-wide" data-cmd="removeFormat" title="Clear formatting">✕ FMT</button>
        </div>

        <!-- Body -->
        <div class="section-body-wrapper">
          <div class="section-content"
               contenteditable="true"
               data-placeholder="Start typing... (use toolbar above for headings, code blocks, lists)"
               spellcheck="false">${sec.content}</div>
          <div class="section-tags-row">
            ${tagsHtml}
            <input type="text" class="tag-add-input" placeholder="+ tag" maxlength="30">
          </div>
        </div>
      </div>
    `;
  }

  function wireSection(card, secId) {
    const tab = getActiveTab();
    if (!tab) return;
    const sec = tab.sections.find(s => s.id === secId);
    if (!sec) return;

    // Collapse toggle
    card.querySelector('.section-collapse-btn').addEventListener('click', () => toggleCollapse(secId));

    // Title input
    const titleInput = card.querySelector('.section-title-input');
    titleInput.addEventListener('input', () => {
      sec.title = titleInput.value;
      markDirty();
    });

    // Delete button
    card.querySelector('.section-action-btn.delete-btn').addEventListener('click', () => deleteSection(secId));

    // Format toolbar buttons
    const content = card.querySelector('.section-content');
    card.querySelectorAll('.fmt-btn[data-cmd]').forEach(btn => {
      btn.addEventListener('mousedown', e => {
        e.preventDefault();
        content.focus();
        const cmd = btn.dataset.cmd;
        const arg = btn.dataset.arg || null;
        document.execCommand(cmd, false, arg);
        persistContent(sec, content);
      });
    });

    // Special actions (inline code, code block, blockquote)
    card.querySelectorAll('.fmt-btn[data-action]').forEach(btn => {
      btn.addEventListener('mousedown', e => {
        e.preventDefault();
        content.focus();
        handleSpecialAction(btn.dataset.action, content);
        persistContent(sec, content);
      });
    });

    // Content editing
    content.addEventListener('input', () => persistContent(sec, content));
    content.addEventListener('paste', e => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, text);
      persistContent(sec, content);
    });

    // Keyboard shortcuts in content
    content.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); document.execCommand('bold'); persistContent(sec, content); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'i') { e.preventDefault(); document.execCommand('italic'); persistContent(sec, content); }
      if ((e.ctrlKey || e.metaKey) && e.key === '`') { e.preventDefault(); handleSpecialAction('inline-code', content); persistContent(sec, content); }
      // Tab inserts 2 spaces (useful for indenting code)
      if (e.key === 'Tab') {
        e.preventDefault();
        document.execCommand('insertText', false, '  ');
        persistContent(sec, content);
      }
    });

    // Tags
    const tagRow = card.querySelector('.section-tags-row');
    const tagInput = tagRow.querySelector('.tag-add-input');

    tagRow.querySelectorAll('.section-tag').forEach(tagEl => {
      tagEl.addEventListener('click', () => {
        const tagVal = tagEl.dataset.tag;
        sec.tags = sec.tags.filter(t => t !== tagVal);
        tagEl.remove();
        markDirty();
      });
    });

    tagInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const val = tagInput.value.trim().replace(/,/g, '');
        if (val && !sec.tags.includes(val)) {
          sec.tags.push(val);
          const chip = document.createElement('span');
          chip.className = 'section-tag';
          chip.dataset.tag = val;
          chip.textContent = val + ' ×';
          chip.addEventListener('click', () => {
            sec.tags = sec.tags.filter(t => t !== val);
            chip.remove();
            markDirty();
          });
          tagRow.insertBefore(chip, tagInput);
          markDirty();
        }
        tagInput.value = '';
      }
    });
  }

  function persistContent(sec, contentEl) {
    sec.content = contentEl.innerHTML;
    markDirty();
  }

  function handleSpecialAction(action, contentEl) {
    const sel = window.getSelection();
    const selectedText = sel ? sel.toString() : '';

    if (action === 'inline-code') {
      if (selectedText) {
        document.execCommand('insertHTML', false, `<code>${escHtml(selectedText)}</code>`);
      } else {
        document.execCommand('insertHTML', false, `<code>\u200B</code>`);
      }
    } else if (action === 'code-block') {
      const code = selectedText || '// paste code here';
      document.execCommand('insertHTML', false, `<pre>${escHtml(code)}</pre><p><br></p>`);
    } else if (action === 'blockquote') {
      if (selectedText) {
        document.execCommand('insertHTML', false, `<blockquote>${escHtml(selectedText)}</blockquote>`);
      } else {
        document.execCommand('formatBlock', false, 'blockquote');
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // COLOR PICKER
  // ──────────────────────────────────────────────────────────────────────────

  function initColorPicker() {
    const picker = document.getElementById('color-picker-dropdown');
    const options = document.getElementById('color-options');
    const dot = document.getElementById('tab-color-dot');
    const btn = document.getElementById('btn-tab-color');

    if (!picker || !options) return;

    options.innerHTML = TAB_COLORS.map(c => `
      <div class="color-swatch ${getActiveTab()?.color === c ? 'selected' : ''}"
           style="background:${c}" data-color="${c}"></div>
    `).join('');

    options.querySelectorAll('.color-swatch').forEach(swatch => {
      swatch.addEventListener('click', () => {
        const tab = getActiveTab();
        if (!tab) return;
        tab.color = swatch.dataset.color;
        dot.style.background = tab.color;
        // Update sidebar dot
        const sideDot = document.querySelector(`.tab-item[data-tab-id="${tab.id}"] .tab-item-dot`);
        if (sideDot) sideDot.style.background = tab.color;
        options.querySelectorAll('.color-swatch').forEach(s => s.classList.toggle('selected', s.dataset.color === tab.color));
        picker.style.display = 'none';
        markDirty();
      });
    });

    if (btn) btn.addEventListener('click', e => {
      e.stopPropagation();
      picker.style.display = picker.style.display === 'none' ? 'block' : 'none';
    });

    // Also clicking the dot toggles picker
    if (dot) dot.addEventListener('click', e => {
      e.stopPropagation();
      picker.style.display = picker.style.display === 'none' ? 'block' : 'none';
    });

    document.addEventListener('click', () => { picker.style.display = 'none'; });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SEARCH
  // ──────────────────────────────────────────────────────────────────────────

  function openSearch() {
    const overlay = document.getElementById('search-overlay');
    const input   = document.getElementById('search-input');
    if (!overlay) return;
    overlay.style.display = 'flex';
    setTimeout(() => input && input.focus(), 50);
  }

  function closeSearch() {
    const overlay = document.getElementById('search-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  function performSearch(query) {
    const results = document.getElementById('search-results');
    if (!results) return;
    const q = query.trim().toLowerCase();

    if (!q) { results.innerHTML = ''; return; }

    const matches = [];
    for (const tab of state.tabs) {
      for (const sec of tab.sections) {
        const titleMatch = sec.title.toLowerCase().includes(q);
        const bodyText   = stripHtml(sec.content).toLowerCase();
        const bodyMatch  = bodyText.includes(q);
        if (titleMatch || bodyMatch) {
          // Get a snippet
          let preview = stripHtml(sec.content).slice(0, 200);
          const idx = preview.toLowerCase().indexOf(q);
          if (idx > 20) preview = '...' + preview.slice(idx - 10);
          preview = preview.slice(0, 120);
          matches.push({ tab, sec, preview });
        }
      }
    }

    if (matches.length === 0) {
      results.innerHTML = `<div class="search-no-results">No results for "${escHtml(query)}"</div>`;
      return;
    }

    results.innerHTML = matches.map(m => `
      <div class="search-result-item" data-tab-id="${m.tab.id}" data-sec-id="${m.sec.id}">
        <div class="search-result-tab">${escHtml(m.tab.title || 'Untitled')}</div>
        <div class="search-result-title">${escHtml(m.sec.title || 'Untitled Section')}</div>
        <div class="search-result-preview">${escHtml(m.preview)}...</div>
      </div>
    `).join('');

    results.querySelectorAll('.search-result-item').forEach(el => {
      el.addEventListener('click', () => {
        setActiveTab(el.dataset.tabId);
        closeSearch();
        // Scroll to section after render
        setTimeout(() => {
          const secCard = document.querySelector(`[data-section-id="${el.dataset.secId}"]`);
          if (secCard) secCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      });
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // EXPORT / IMPORT
  // ──────────────────────────────────────────────────────────────────────────

  function exportNotes() {
    const payload = {
      exportedAt: new Date().toISOString(),
      companyId: state.companyId,
      tabs: state.tabs
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `developer-notes-${state.companyId}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Notes exported successfully', 'success');
  }

  function triggerImport() {
    document.getElementById('import-file-input').click();
  }

  function handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const data = JSON.parse(evt.target.result);
        if (!data.tabs || !Array.isArray(data.tabs)) throw new Error('Invalid format');
        if (!confirm(`Import ${data.tabs.length} notebook(s)? This will MERGE with your existing notes (new tabs will be added).`)) return;
        for (const tab of data.tabs) {
          // Assign new IDs to avoid collisions
          const newTab = { ...tab, id: uid() };
          newTab.sections = (tab.sections || []).map(s => ({ ...s, id: uid() }));
          state.tabs.push(newTab);
        }
        renderSidebar();
        renderEditor();
        markDirty();
        showToast(`Imported ${data.tabs.length} notebook(s)`, 'success');
      } catch (err) {
        showToast('Import failed: invalid JSON format', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  // ──────────────────────────────────────────────────────────────────────────
  // INITIALIZATION
  // ──────────────────────────────────────────────────────────────────────────

  async function init() {
    state.companyId = getCompanyId();
    if (!state.companyId) {
      document.body.innerHTML = '<div style="padding:2rem;color:#EF4444;font-family:sans-serif;">Missing companyId in URL</div>';
      return;
    }

    // Company ID pill
    const pill = document.getElementById('notes-company-id');
    if (pill) pill.textContent = state.companyId.slice(0, 8) + '…';

    setBackLink();

    // Load from server
    setSaveStatus('saving', 'Loading...');
    try {
      const data = await apiLoad();
      state.tabs = data.notes?.tabs || [];
      state.activeTabId = data.notes?.lastActiveTabId || (state.tabs[0]?.id ?? null);
      setSaveStatus('saved');
    } catch (err) {
      console.error('[Notes] Load error:', err);
      setSaveStatus('error', 'Failed to load notes');
      showToast('Could not load notes from server', 'error');
    }

    renderSidebar();
    renderEditor();
    initColorPicker();
    attachGlobalListeners();
  }

  function attachGlobalListeners() {
    // Add tab buttons
    document.getElementById('btn-add-tab')?.addEventListener('click', addTab);
    document.getElementById('btn-add-first-tab')?.addEventListener('click', addTab);
    document.getElementById('btn-add-section')?.addEventListener('click', addSection);

    // Delete tab
    document.getElementById('btn-delete-tab')?.addEventListener('click', () => {
      if (state.activeTabId) deleteTab(state.activeTabId);
    });

    // Search
    document.getElementById('btn-search')?.addEventListener('click', openSearch);
    document.getElementById('search-close')?.addEventListener('click', closeSearch);
    document.getElementById('search-input')?.addEventListener('input', e => performSearch(e.target.value));

    // Search overlay background click → close
    document.getElementById('search-overlay')?.addEventListener('click', e => {
      if (e.target === document.getElementById('search-overlay')) closeSearch();
    });

    // Keyboard: Ctrl+F for search, Escape to close
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); openSearch(); }
      if (e.key === 'Escape') closeSearch();
    });

    // Export / Import
    document.getElementById('btn-export')?.addEventListener('click', exportNotes);
    document.getElementById('btn-import')?.addEventListener('click', triggerImport);
    document.getElementById('import-file-input')?.addEventListener('change', handleImport);

    // Save on unload
    window.addEventListener('beforeunload', () => {
      if (state.dirty) {
        clearTimeout(state.saveTimer);
        apiSave({ tabs: state.tabs, lastActiveTabId: state.activeTabId }).catch(() => {});
      }
    });
  }

  // Kick off
  init();

})();
