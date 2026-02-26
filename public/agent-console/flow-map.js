(function() {
  'use strict';

  const state = {
    companyId: null,
    notes: [],
    selectedId: null,
    editingId: null,
    zCounter: 1,
    drag: null
  };

  const DOM = {
    headerCompanyName: document.getElementById('header-company-name'),
    headerCompanyId: document.getElementById('header-company-id'),
    btnBackToDashboard: document.getElementById('btn-back-to-dashboard'),
    btnNewNote: document.getElementById('btn-new-note'),
    btnClearMap: document.getElementById('btn-clear-map'),
    btnExportMap: document.getElementById('btn-export-map'),
    btnImportMap: document.getElementById('btn-import-map'),
    inputImportMap: document.getElementById('input-import-map'),
    board: document.getElementById('map-board'),
    stepList: document.getElementById('step-list'),
    modalBackdrop: document.getElementById('map-modal-backdrop'),
    noteTitle: document.getElementById('map-note-title'),
    noteBody: document.getElementById('map-note-body'),
    btnCancelNote: document.getElementById('btn-cancel-note'),
    btnSaveNote: document.getElementById('btn-save-note')
  };

  function init() {
    if (!window.AgentConsoleAuth || !AgentConsoleAuth.requireAuth()) return;

    const params = new URLSearchParams(window.location.search);
    state.companyId = params.get('companyId');

    if (!state.companyId) {
      window.location.href = '/agent-console/index.html';
      return;
    }

    DOM.headerCompanyId.textContent = truncateId(state.companyId);
    DOM.headerCompanyId.title = state.companyId;
    loadCompanyName();
    loadNotes();
    bindEvents();
    render();
  }

  async function loadCompanyName() {
    try {
      const data = await AgentConsoleAuth.apiFetch(`/api/agent-console/${state.companyId}/truth`);
      DOM.headerCompanyName.textContent = data?.companyProfile?.businessName || data?.companyProfile?.companyName || 'Company';
    } catch (err) {
      DOM.headerCompanyName.textContent = 'Company';
    }
  }

  function truncateId(id) {
    if (!id || id.length <= 12) return id || '—';
    return `${id.slice(0, 6)}...${id.slice(-4)}`;
  }

  function getStorageKey() {
    return `agentConsole.flowMap.v1:${state.companyId}`;
  }

  function loadNotes() {
    try {
      const raw = localStorage.getItem(getStorageKey());
      if (!raw) {
        state.notes = [];
        return;
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.notes)) {
        state.notes = parsed.notes.map(normalizeNote).filter(Boolean);
        state.zCounter = Number(parsed.zCounter || 1);
      }
    } catch (err) {
      state.notes = [];
    }
  }

  function saveNotes() {
    localStorage.setItem(
      getStorageKey(),
      JSON.stringify({
        notes: state.notes,
        zCounter: state.zCounter
      })
    );
  }

  function normalizeNote(note) {
    if (!note || typeof note !== 'object') return null;
    return {
      id: String(note.id || makeId()),
      title: String(note.title || '').trim() || 'Untitled Step',
      body: String(note.body || ''),
      x: Number.isFinite(note.x) ? note.x : 20,
      y: Number.isFinite(note.y) ? note.y : 20,
      sequence: Number.isFinite(note.sequence) ? note.sequence : 1,
      z: Number.isFinite(note.z) ? note.z : 1
    };
  }

  function bindEvents() {
    DOM.btnBackToDashboard.addEventListener('click', () => {
      window.location.href = `/agent-console/index.html?companyId=${encodeURIComponent(state.companyId)}`;
    });

    DOM.btnNewNote.addEventListener('click', () => openModal(null));
    DOM.btnClearMap.addEventListener('click', clearMap);
    DOM.btnExportMap.addEventListener('click', exportMap);
    DOM.btnImportMap.addEventListener('click', () => DOM.inputImportMap.click());
    DOM.inputImportMap.addEventListener('change', importMap);

    DOM.btnCancelNote.addEventListener('click', closeModal);
    DOM.btnSaveNote.addEventListener('click', saveModalNote);
    DOM.modalBackdrop.addEventListener('click', (event) => {
      if (event.target === DOM.modalBackdrop) closeModal();
    });

    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', handlePointerUp);
  }

  function openModal(noteId) {
    state.editingId = noteId;
    const note = noteId ? state.notes.find((n) => n.id === noteId) : null;
    DOM.noteTitle.value = note?.title || '';
    DOM.noteBody.value = note?.body || '';
    DOM.modalBackdrop.classList.add('open');
    DOM.noteTitle.focus();
  }

  function closeModal() {
    state.editingId = null;
    DOM.modalBackdrop.classList.remove('open');
  }

  function saveModalNote() {
    const title = (DOM.noteTitle.value || '').trim() || 'Untitled Step';
    const body = (DOM.noteBody.value || '').trim();

    if (state.editingId) {
      const note = state.notes.find((n) => n.id === state.editingId);
      if (note) {
        note.title = title;
        note.body = body;
      }
    } else {
      const nextSequence = getSortedNotes().length + 1;
      state.zCounter += 1;
      const newNote = {
        id: makeId(),
        title,
        body,
        x: 30 + (state.notes.length % 6) * 36,
        y: 24 + (state.notes.length % 5) * 28,
        sequence: nextSequence,
        z: state.zCounter
      };
      state.notes.push(newNote);
      state.selectedId = newNote.id;
    }

    saveNotes();
    render();
    closeModal();
  }

  function clearMap() {
    if (!window.confirm('Delete all map bubbles for this company?')) return;
    state.notes = [];
    state.selectedId = null;
    saveNotes();
    render();
  }

  function exportMap() {
    const payload = {
      companyId: state.companyId,
      exportedAt: new Date().toISOString(),
      notes: state.notes
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `flow-map-${state.companyId}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  async function importMap(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed.notes)) throw new Error('Invalid map file.');
      state.notes = parsed.notes.map(normalizeNote).filter(Boolean);
      state.zCounter = state.notes.reduce((max, n) => Math.max(max, n.z || 1), 1);
      saveNotes();
      render();
    } catch (err) {
      window.alert(`Import failed: ${err.message}`);
    } finally {
      event.target.value = '';
    }
  }

  function getSortedNotes() {
    return [...state.notes].sort((a, b) => (a.sequence - b.sequence) || a.title.localeCompare(b.title));
  }

  function render() {
    renderStepList();
    renderBoard();
  }

  function renderStepList() {
    const notes = getSortedNotes();
    if (notes.length === 0) {
      DOM.stepList.innerHTML = '<div class="map-hint">No bubbles yet. Click "New Bubble" to start mapping.</div>';
      return;
    }

    DOM.stepList.innerHTML = notes.map((note) => `
      <div class="step-item ${state.selectedId === note.id ? 'active' : ''}" data-step-id="${escapeHtml(note.id)}">
        <div class="step-item-row">
          <p class="step-item-title">${escapeHtml(note.title)}</p>
          <div class="step-item-controls">
            <button class="tiny-btn" data-action="up" data-id="${escapeHtml(note.id)}">Up</button>
            <button class="tiny-btn" data-action="down" data-id="${escapeHtml(note.id)}">Down</button>
          </div>
        </div>
        <div class="step-item-meta">Sequence ${note.sequence} · (${Math.round(note.x)}, ${Math.round(note.y)})</div>
      </div>
    `).join('');

    DOM.stepList.querySelectorAll('.step-item').forEach((item) => {
      item.addEventListener('click', (event) => {
        if (event.target.closest('button')) return;
        const id = item.dataset.stepId;
        state.selectedId = id;
        focusNote(id);
        render();
      });
    });

    DOM.stepList.querySelectorAll('button[data-action]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const id = button.dataset.id;
        moveSequence(id, button.dataset.action === 'up' ? -1 : 1);
      });
    });
  }

  function renderBoard() {
    DOM.board.innerHTML = '';
    state.notes
      .sort((a, b) => a.z - b.z)
      .forEach((note) => {
        const el = document.createElement('div');
        el.className = `map-note ${state.selectedId === note.id ? 'active' : ''}`;
        el.style.left = `${note.x}px`;
        el.style.top = `${note.y}px`;
        el.style.zIndex = String(note.z || 1);
        el.dataset.noteId = note.id;
        el.innerHTML = `
          <div class="map-note-header" data-drag-handle="true">
            <h4 class="map-note-title">${escapeHtml(note.title)}</h4>
            <span class="tag-seq">#${note.sequence}</span>
          </div>
          <div class="map-note-body">${escapeHtml(note.body || '(No description yet)')}</div>
          <div class="map-note-footer">
            <div class="map-note-controls">
              <button class="tiny-btn" data-note-action="edit">Edit</button>
              <button class="tiny-btn" data-note-action="up">Up</button>
              <button class="tiny-btn" data-note-action="down">Down</button>
            </div>
            <button class="tiny-btn" data-note-action="delete">Delete</button>
          </div>
        `;

        el.addEventListener('mousedown', (event) => {
          state.selectedId = note.id;
          bringToFront(note.id);
          if (event.target.closest('[data-drag-handle="true"]')) {
            startDrag(event, note.id);
          } else {
            render();
          }
        });

        el.querySelectorAll('[data-note-action]').forEach((button) => {
          button.addEventListener('click', (event) => {
            event.stopPropagation();
            const action = button.dataset.noteAction;
            if (action === 'edit') openModal(note.id);
            if (action === 'delete') deleteNote(note.id);
            if (action === 'up') moveSequence(note.id, -1);
            if (action === 'down') moveSequence(note.id, 1);
          });
        });

        DOM.board.appendChild(el);
      });
  }

  function startDrag(event, noteId) {
    const note = state.notes.find((n) => n.id === noteId);
    if (!note) return;
    const boardRect = DOM.board.getBoundingClientRect();
    state.drag = {
      noteId,
      offsetX: event.clientX - boardRect.left - note.x,
      offsetY: event.clientY - boardRect.top - note.y
    };
  }

  function handlePointerMove(event) {
    if (!state.drag) return;
    const note = state.notes.find((n) => n.id === state.drag.noteId);
    if (!note) return;

    const boardRect = DOM.board.getBoundingClientRect();
    const noteWidth = 260;
    const noteHeight = 150;
    const maxX = Math.max(0, boardRect.width - noteWidth);
    const maxY = Math.max(0, boardRect.height - noteHeight);

    note.x = clamp(event.clientX - boardRect.left - state.drag.offsetX, 0, maxX);
    note.y = clamp(event.clientY - boardRect.top - state.drag.offsetY, 0, maxY);
    renderBoard();
  }

  function handlePointerUp() {
    if (!state.drag) return;
    state.drag = null;
    saveNotes();
    renderStepList();
  }

  function moveSequence(noteId, direction) {
    const sorted = getSortedNotes();
    const index = sorted.findIndex((n) => n.id === noteId);
    if (index < 0) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= sorted.length) return;

    const current = sorted[index];
    const adjacent = sorted[nextIndex];
    const temp = current.sequence;
    current.sequence = adjacent.sequence;
    adjacent.sequence = temp;
    saveNotes();
    render();
  }

  function focusNote(noteId) {
    const note = state.notes.find((n) => n.id === noteId);
    if (!note) return;
    bringToFront(noteId);
    renderBoard();
  }

  function bringToFront(noteId) {
    const note = state.notes.find((n) => n.id === noteId);
    if (!note) return;
    state.zCounter += 1;
    note.z = state.zCounter;
    saveNotes();
  }

  function deleteNote(noteId) {
    state.notes = state.notes.filter((n) => n.id !== noteId);
    if (state.selectedId === noteId) state.selectedId = null;
    resequence();
    saveNotes();
    render();
  }

  function resequence() {
    getSortedNotes().forEach((note, idx) => {
      note.sequence = idx + 1;
    });
  }

  function makeId() {
    return `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  init();
})();
