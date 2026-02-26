(function() {
  'use strict';
  
  console.log('[FlowMap] ✓ Script loaded');

  const state = {
    companyId: null,
    notes: [],
    connections: [], // Array of {from: noteId, to: noteId}
    selectedId: null,
    editingId: null,
    zCounter: 1,
    drag: null,
    connectMode: false,
    connectFrom: null
  };

  let DOM = {};

  function initDOM() {
    console.log('[FlowMap] ✓ initDOM() called');
    DOM = {
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
      btnSaveNote: document.getElementById('btn-save-note'),
      arrowSvg: null // Will be created dynamically
    };
    console.log('[FlowMap] ✓ DOM elements:', {
      board: DOM.board ? '✓' : '✗',
      modalBackdrop: DOM.modalBackdrop ? '✓' : '✗',
      noteTitle: DOM.noteTitle ? '✓' : '✗'
    });
  }

  function init() {
    try {
      console.log('[FlowMap] Initializing...');
      initDOM();

      const params = new URLSearchParams(window.location.search);
      state.companyId = params.get('companyId');

      if (!state.companyId) {
        window.location.href = '/agent-console/index.html';
        return;
      }

      // Set default company name immediately to remove "Loading..." state
      DOM.headerCompanyName.textContent = 'Company';
      DOM.headerCompanyId.textContent = truncateId(state.companyId);
      DOM.headerCompanyId.title = state.companyId;
      
      console.log('[FlowMap] Binding events...');
      bindEvents();
      console.log('[FlowMap] Loading notes...');
      loadNotes();
      console.log('[FlowMap] Rendering...');
      render();
      console.log('[FlowMap] Initialization complete');

      // Try to load company name asynchronously (optional enhancement)
      const authReady = canUseAgentConsoleAuth();
      if (authReady) {
        loadCompanyName();
      }
    } catch (err) {
      console.error('[FlowMap] Initialization error:', err);
    }
  }

  async function loadCompanyName() {
    try {
      if (!window.AgentConsoleAuth || typeof AgentConsoleAuth.apiFetch !== 'function') {
        DOM.headerCompanyName.textContent = 'Company';
        return;
      }
      const data = await AgentConsoleAuth.apiFetch(`/api/agent-console/${state.companyId}/truth`);
      DOM.headerCompanyName.textContent = data?.companyProfile?.businessName || data?.companyProfile?.companyName || 'Company';
    } catch (err) {
      DOM.headerCompanyName.textContent = 'Company';
    }
  }

  function canUseAgentConsoleAuth() {
    try {
      if (!window.AgentConsoleAuth || typeof AgentConsoleAuth.requireAuth !== 'function') return false;
      // Don't call requireAuth() as it may redirect - just check if auth is available
      if (typeof AgentConsoleAuth.getToken !== 'function') return false;
      return !!AgentConsoleAuth.getToken();
    } catch (err) {
      // Keep Flow Map usable even if auth bootstrap fails in browser.
      console.warn('[FlowMap] Auth check failed:', err);
      return false;
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
        state.connections = [];
        return;
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.notes)) {
        state.notes = parsed.notes.map(normalizeNote).filter(Boolean);
        state.zCounter = Number(parsed.zCounter || 1);
        state.connections = Array.isArray(parsed.connections) ? parsed.connections : [];
      }
    } catch (err) {
      state.notes = [];
      state.connections = [];
    }
  }

  function saveNotes() {
    localStorage.setItem(
      getStorageKey(),
      JSON.stringify({
        notes: state.notes,
        connections: state.connections,
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
    console.log('[FlowMap] ✓ bindEvents() called');
    
    if (DOM.btnBackToDashboard) {
      DOM.btnBackToDashboard.addEventListener('click', () => {
        console.log('[FlowMap] ✓ Back button clicked');
        window.location.href = `/agent-console/index.html?companyId=${encodeURIComponent(state.companyId)}`;
      });
    }

    if (DOM.btnNewNote) {
      console.log('[FlowMap] ✓ Binding New Bubble button');
      DOM.btnNewNote.addEventListener('click', () => {
        console.log('[FlowMap] ✓ New Bubble button clicked');
        openModal(null);
      });
    }
    // Emergency global hook so the button can still work if another listener path fails.
    window.__flowMapOpenNewNote = () => openModal(null);

    if (DOM.btnClearMap) {
      console.log('[FlowMap] ✓ Binding Clear Map button');
      DOM.btnClearMap.addEventListener('click', clearMap);
    }
    if (DOM.btnExportMap) DOM.btnExportMap.addEventListener('click', exportMap);
    if (DOM.btnImportMap && DOM.inputImportMap) {
      DOM.btnImportMap.addEventListener('click', () => DOM.inputImportMap.click());
      DOM.inputImportMap.addEventListener('change', importMap);
    }

    if (DOM.btnCancelNote) {
      console.log('[FlowMap] ✓ Binding Cancel button');
      DOM.btnCancelNote.addEventListener('click', closeModal);
    }
    if (DOM.btnSaveNote) {
      console.log('[FlowMap] ✓ Binding Save button');
      DOM.btnSaveNote.addEventListener('click', saveModalNote);
    }
    if (DOM.modalBackdrop) {
      console.log('[FlowMap] ✓ Binding modal backdrop');
      DOM.modalBackdrop.addEventListener('click', (event) => {
        if (event.target === DOM.modalBackdrop) closeModal();
      });
    }

    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', handlePointerUp);
    console.log('[FlowMap] ✓ All header events bound');
  }

  function openModal(noteId) {
    console.log('[FlowMap] ✓ openModal() called, noteId:', noteId);
    console.log('[FlowMap] ✓ DOM.modalBackdrop:', DOM.modalBackdrop);
    console.log('[FlowMap] ✓ DOM.noteTitle:', DOM.noteTitle);
    console.log('[FlowMap] ✓ DOM.noteBody:', DOM.noteBody);
    
    state.editingId = noteId;
    const note = noteId ? state.notes.find((n) => n.id === noteId) : null;
    DOM.noteTitle.value = note?.title || '';
    DOM.noteBody.value = note?.body || '';
    DOM.modalBackdrop.classList.add('open');
    DOM.noteTitle.focus();
    console.log('[FlowMap] ✓ Modal opened successfully');
  }

  function closeModal() {
    console.log('[FlowMap] ✓ closeModal() called');
    state.editingId = null;
    DOM.modalBackdrop.classList.remove('open');
    console.log('[FlowMap] ✓ Modal closed');
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
    if (!window.confirm('Delete all map bubbles and connections for this company?')) return;
    state.notes = [];
    state.connections = [];
    state.selectedId = null;
    saveNotes();
    render();
  }

  function exportMap() {
    const payload = {
      companyId: state.companyId,
      exportedAt: new Date().toISOString(),
      notes: state.notes,
      connections: state.connections
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
      state.connections = Array.isArray(parsed.connections) ? parsed.connections : [];
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
    try {
      console.log('[FlowMap] Rendering board...');
      DOM.board.innerHTML = '';
      
      // Create SVG for arrows
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'arrow-layer');
      svg.style.position = 'absolute';
      svg.style.top = '0';
      svg.style.left = '0';
      svg.style.width = '100%';
      svg.style.height = '100%';
      svg.style.pointerEvents = 'none';
      svg.style.zIndex = '0';
      DOM.board.appendChild(svg);
      DOM.arrowSvg = svg;
      
      // Render arrows
      renderArrows();
    
    // Render notes
    state.notes
      .sort((a, b) => a.z - b.z)
      .forEach((note) => {
        const el = document.createElement('div');
        el.className = `map-note ${state.selectedId === note.id ? 'active' : ''} ${state.connectFrom === note.id ? 'connect-source' : ''}`;
        el.style.left = `${note.x}px`;
        el.style.top = `${note.y}px`;
        el.style.zIndex = String(note.z || 1);
        el.dataset.noteId = note.id;
        
        const connectionCount = state.connections.filter(c => c.from === note.id || c.to === note.id).length;
        
        el.innerHTML = `
          <div class="map-note-header" data-drag-handle="true">
            <h4 class="map-note-title">${escapeHtml(note.title)}</h4>
            <span class="tag-seq">#${note.sequence}</span>
          </div>
          <div class="map-note-body">${escapeHtml(note.body || '(No description yet)')}</div>
          <div class="map-note-footer">
            <div class="map-note-controls">
              <button class="tiny-btn" data-note-action="edit">Edit</button>
              <button class="tiny-btn" data-note-action="connect" title="Draw arrow to another bubble">→</button>
              <button class="tiny-btn" data-note-action="up">Up</button>
              <button class="tiny-btn" data-note-action="down">Down</button>
            </div>
            <button class="tiny-btn" data-note-action="delete">Delete</button>
          </div>
        `;

        el.addEventListener('mousedown', (event) => {
          // Handle connect mode
          if (state.connectMode && !event.target.closest('button')) {
            event.preventDefault();
            handleConnectClick(note.id);
            return;
          }
          
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
            console.log('[FlowMap] Button clicked:', action, 'for note:', note.id);
            if (action === 'edit') openModal(note.id);
            if (action === 'delete') deleteNote(note.id);
            if (action === 'connect') startConnect(note.id);
            if (action === 'up') moveSequence(note.id, -1);
            if (action === 'down') moveSequence(note.id, 1);
          });
        });

        DOM.board.appendChild(el);
      });
      console.log('[FlowMap] Board rendered successfully');
    } catch (err) {
      console.error('[FlowMap] Error rendering board:', err);
    }
  }
  
  function renderArrows() {
    if (!DOM.arrowSvg) return;
    
    // Clear existing arrows
    DOM.arrowSvg.innerHTML = '';
    
    // Define arrowhead marker
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', 'arrowhead');
    marker.setAttribute('markerWidth', '10');
    marker.setAttribute('markerHeight', '10');
    marker.setAttribute('refX', '9');
    marker.setAttribute('refY', '3');
    marker.setAttribute('orient', 'auto');
    const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    polygon.setAttribute('points', '0 0, 10 3, 0 6');
    polygon.setAttribute('fill', '#3b82f6');
    marker.appendChild(polygon);
    defs.appendChild(marker);
    DOM.arrowSvg.appendChild(defs);
    
    // Draw each connection
    state.connections.forEach((conn) => {
      const fromNote = state.notes.find(n => n.id === conn.from);
      const toNote = state.notes.find(n => n.id === conn.to);
      
      if (!fromNote || !toNote) return;
      
      // Calculate center points of notes (260px wide, ~150px tall)
      const fromX = fromNote.x + 130;
      const fromY = fromNote.y + 75;
      const toX = toNote.x + 130;
      const toY = toNote.y + 75;
      
      // Create path
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const midX = (fromX + toX) / 2;
      const midY = (fromY + toY) / 2;
      
      // Curved path
      const d = `M ${fromX} ${fromY} Q ${midX} ${midY} ${toX} ${toY}`;
      path.setAttribute('d', d);
      path.setAttribute('stroke', '#3b82f6');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('fill', 'none');
      path.setAttribute('marker-end', 'url(#arrowhead)');
      path.style.cursor = 'pointer';
      path.style.pointerEvents = 'stroke';
      
      // Add click to delete
      path.addEventListener('click', () => {
        if (window.confirm('Delete this arrow connection?')) {
          state.connections = state.connections.filter(c => c !== conn);
          saveNotes();
          render();
        }
      });
      
      DOM.arrowSvg.appendChild(path);
    });
  }
  
  function startConnect(noteId) {
    state.connectMode = true;
    state.connectFrom = noteId;
    render();
  }
  
  function handleConnectClick(toNoteId) {
    if (!state.connectFrom || state.connectFrom === toNoteId) {
      // Cancel connect mode
      state.connectMode = false;
      state.connectFrom = null;
      render();
      return;
    }
    
    // Check if connection already exists
    const exists = state.connections.some(c => 
      c.from === state.connectFrom && c.to === toNoteId
    );
    
    if (!exists) {
      state.connections.push({
        from: state.connectFrom,
        to: toNoteId
      });
      saveNotes();
    }
    
    state.connectMode = false;
    state.connectFrom = null;
    render();
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

  // Wait for DOM to be ready before initializing
  console.log('[FlowMap] ✓ Setting up initialization, readyState:', document.readyState);
  if (document.readyState === 'loading') {
    console.log('[FlowMap] ✓ Waiting for DOMContentLoaded...');
    document.addEventListener('DOMContentLoaded', init);
  } else {
    console.log('[FlowMap] ✓ DOM already ready, calling init()');
    init();
  }
  console.log('[FlowMap] ✓ IIFE complete');
})();
