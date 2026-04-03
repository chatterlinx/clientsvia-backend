/**
 * ============================================================================
 * PROMPT AUDIO CONTROLS — Shared Module
 * ClientsVia Agent Console
 *
 * Adds "Generate Audio" / "Play" controls to any textarea with a
 * data-audio-key attribute.  Replicates the KC fixed-audio pattern from
 * services-item.html in a page-agnostic way.
 *
 * Usage:
 *   <script src="/agent-console/lib/prompt-audio.js"></script>
 *   <textarea data-audio-key="builtinName.askPrompt" ...></textarea>
 *
 *   PromptAudioControls.init({ companyId, apiFetch });
 *   PromptAudioControls.injectAll();
 *   PromptAudioControls.loadState(savedPromptAudio);   // from GET config
 *   // ... on save:
 *   const promptAudio = PromptAudioControls.collectAll();
 * ============================================================================
 */

const PromptAudioControls = (function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────
  let _companyId = null;
  let _apiFetch  = null;   // (url, { method, body }) => Promise<json>
  let _inited    = false;
  const _audioMap = new Map(); // key → { url, generatedText, audio }

  // ── Init ───────────────────────────────────────────────────────────────
  function init({ companyId, apiFetch }) {
    _companyId = companyId;
    _apiFetch  = apiFetch;
    if (!_inited) { _injectCSS(); _inited = true; }
  }

  // ── CSS (injected once) ────────────────────────────────────────────────
  function _injectCSS() {
    if (document.getElementById('pa-audio-styles')) return;
    const style = document.createElement('style');
    style.id = 'pa-audio-styles';
    style.textContent = `
      .pa-audio-row {
        display: flex; align-items: center; gap: 8px;
        margin-top: 6px; flex-wrap: wrap;
      }
      .pa-gen-btn {
        display: inline-flex; align-items: center; gap: 5px;
        padding: 4px 10px; border-radius: 6px;
        font-size: .72rem; font-weight: 600;
        border: 1px solid #0ea5e9; color: #0ea5e9;
        background: transparent; cursor: pointer;
        transition: background .15s; white-space: nowrap;
      }
      .pa-gen-btn:hover:not(:disabled) { background: #f0f9ff; }
      .pa-gen-btn:disabled { opacity: .5; cursor: not-allowed; }
      .pa-play-btn {
        display: inline-flex; align-items: center; gap: 5px;
        padding: 4px 10px; border-radius: 6px;
        font-size: .72rem; font-weight: 600;
        border: 1px solid #16a34a; color: #16a34a;
        background: transparent; cursor: pointer;
        transition: background .15s; white-space: nowrap;
      }
      .pa-play-btn:hover { background: #f0fdf4; }
      .pa-hint { font-size: .70rem; }
      .pa-hint.ok    { color: #16a34a; }
      .pa-hint.stale { color: #d97706; }
      .pa-hint.err   { color: #dc2626; }
      .pa-hint.vars  { color: #7c3aed; }
    `;
    document.head.appendChild(style);
  }

  // ── CSS-safe key (dots / brackets → dashes) ────────────────────────────
  function _safeId(key) { return key.replace(/[^a-zA-Z0-9_-]/g, '-'); }

  // ── Inject controls after every [data-audio-key] element ───────────────
  function injectAll() {
    const els = document.querySelectorAll('[data-audio-key]');
    els.forEach(el => {
      const key  = el.getAttribute('data-audio-key');
      const safe = _safeId(key);

      // Skip if already injected
      if (document.getElementById(`pa-ar--${safe}`)) return;

      const row = document.createElement('div');
      row.className = 'pa-audio-row';
      row.id = `pa-ar--${safe}`;
      row.innerHTML =
        `<button type="button" class="pa-gen-btn" id="pa-gen--${safe}">🎙️ Generate Audio</button>` +
        `<button type="button" class="pa-play-btn" id="pa-play--${safe}" style="display:none">▶ Play</button>` +
        `<span class="pa-hint" id="pa-hint--${safe}"></span>`;

      // Insert after the textarea (or its parent .form-group if wrapped)
      el.insertAdjacentElement('afterend', row);

      // Wire buttons
      row.querySelector('.pa-gen-btn').addEventListener('click', () => genAudio(key));
      row.querySelector('.pa-play-btn').addEventListener('click', () => playAudio(key));

      // Wire text change → stale detection
      el.addEventListener('input', () => markStale(key, el.value));

      // Immediate variable check for existing content
      _checkVars(key, el.value);
    });
  }

  // ── Variable check (show warning if text has {placeholders}) ───────────
  function _checkVars(key, text) {
    const safe   = _safeId(key);
    const hintEl = document.getElementById(`pa-hint--${safe}`);
    const genBtn = document.getElementById(`pa-gen--${safe}`);
    const varMatch = (text || '').match(/\{[^}]+\}/);
    if (varMatch) {
      if (hintEl) {
        hintEl.textContent = `🚫 Contains ${varMatch[0]} — caller data is substituted at call time; cannot pre-record`;
        hintEl.className = 'pa-hint vars';
      }
      if (genBtn) genBtn.style.display = 'none';
      return true;
    }
    // Clear variable warning if it was showing
    if (hintEl?.classList.contains('vars')) {
      hintEl.textContent = '';
      hintEl.className   = 'pa-hint';
    }
    if (genBtn) genBtn.style.display = '';
    return false;
  }

  // ── Generate audio ─────────────────────────────────────────────────────
  async function genAudio(key) {
    const safe   = _safeId(key);
    const textEl = document.querySelector(`[data-audio-key="${key}"]`);
    const text   = textEl?.value?.trim() || '';
    const hintEl = document.getElementById(`pa-hint--${safe}`);
    const playBtn = document.getElementById(`pa-play--${safe}`);
    const genBtn  = document.getElementById(`pa-gen--${safe}`);
    if (!genBtn) return;

    if (!text) {
      if (hintEl) { hintEl.textContent = '⚠️ No text to generate'; hintEl.className = 'pa-hint stale'; }
      return;
    }

    // Block if text has runtime variables
    if (_checkVars(key, text)) return;

    genBtn.disabled    = true;
    genBtn.textContent = '⏳ Generating…';
    if (hintEl) { hintEl.textContent = ''; hintEl.className = 'pa-hint'; }

    try {
      const data = await _apiFetch(
        `/api/admin/agent2/company/${_companyId}/knowledge/preview-fixed-audio`,
        { method: 'POST', body: { text } }
      );
      if (!data.success) throw new Error(data.error || 'Generation failed');

      _audioMap.set(key, { url: data.url, generatedText: text, audio: null });

      genBtn.textContent = '🔄 Regenerate';
      genBtn.disabled    = false;
      if (playBtn) playBtn.style.display = '';
      if (hintEl) {
        hintEl.textContent = data.generated ? '✅ Generated' : '✅ Cached';
        hintEl.className   = 'pa-hint ok';
      }
    } catch (err) {
      genBtn.textContent = '🎙️ Generate Audio';
      genBtn.disabled    = false;
      if (hintEl) {
        hintEl.textContent = `❌ ${err.message || 'Generation failed'}`;
        hintEl.className   = 'pa-hint err';
      }
    }
  }

  // ── Play / Stop ────────────────────────────────────────────────────────
  function playAudio(key) {
    const safe    = _safeId(key);
    const state   = _audioMap.get(key);
    const playBtn = document.getElementById(`pa-play--${safe}`);
    if (!state?.url || !playBtn) return;

    if (state.audio && !state.audio.paused) {
      state.audio.pause();
      state.audio.currentTime = 0;
      playBtn.textContent = '▶ Play';
      return;
    }

    const audio = new Audio(`${state.url}?_cb=${Date.now()}`);
    state.audio = audio;
    playBtn.textContent = '⏹ Stop';

    audio.onended = () => { playBtn.textContent = '▶ Play'; };
    audio.onerror = () => { playBtn.textContent = '▶ Play'; };
    audio.play().catch(() => { playBtn.textContent = '▶ Play'; });
  }

  // ── Mark stale on text change ──────────────────────────────────────────
  function markStale(key, currentText) {
    if (_checkVars(key, currentText)) return;

    const safe   = _safeId(key);
    const hintEl = document.getElementById(`pa-hint--${safe}`);
    const genBtn = document.getElementById(`pa-gen--${safe}`);
    const state  = _audioMap.get(key);
    if (!state?.url) return;
    if ((currentText?.trim() ?? '') !== state.generatedText) {
      if (hintEl) { hintEl.textContent = '⚠️ Text changed — regenerate audio'; hintEl.className = 'pa-hint stale'; }
      if (genBtn) genBtn.textContent = '🔄 Regenerate';
    }
  }

  // ── Restore single entry from saved state ──────────────────────────────
  function restoreState(key, url, generatedText) {
    if (!url) return;
    const safe    = _safeId(key);
    const safeUrl = url.replace('/audio/instant-lines/', '/audio-safe/instant-lines/');
    _audioMap.set(key, { url: safeUrl, generatedText: generatedText?.trim() || '', audio: null });

    const playBtn = document.getElementById(`pa-play--${safe}`);
    const genBtn  = document.getElementById(`pa-gen--${safe}`);
    const hintEl  = document.getElementById(`pa-hint--${safe}`);

    // HEAD check — verify audio is still reachable
    fetch(safeUrl, { method: 'HEAD' }).then(r => {
      if (r.ok) {
        if (playBtn) playBtn.style.display = '';
        if (genBtn)  genBtn.textContent = '🔄 Regenerate';
        if (hintEl)  { hintEl.textContent = '✅ Cached'; hintEl.className = 'pa-hint ok'; }
      } else {
        if (genBtn) genBtn.textContent = '🔄 Regenerate';
        if (hintEl) { hintEl.textContent = '⚠️ Audio lost after deploy — regenerate'; hintEl.className = 'pa-hint stale'; }
      }
    }).catch(() => {
      if (genBtn) genBtn.textContent = '🔄 Regenerate';
      if (hintEl) { hintEl.textContent = '⚠️ Audio unavailable'; hintEl.className = 'pa-hint stale'; }
    });
  }

  // ── Load all state from saved promptAudio map ──────────────────────────
  function loadState(promptAudio) {
    if (!promptAudio || typeof promptAudio !== 'object') return;
    for (const [key, entry] of Object.entries(promptAudio)) {
      if (!entry?.url) continue;
      restoreState(key, entry.url, entry.generatedText || '');
    }
  }

  // ── Collect all state for save ─────────────────────────────────────────
  function collectAll() {
    const result = {};
    _audioMap.forEach((state, key) => {
      if (state.url) {
        result[key] = { url: state.url, generatedText: state.generatedText || '' };
      }
    });
    return result;
  }

  // ── Public API ─────────────────────────────────────────────────────────
  return {
    init,
    injectAll,
    genAudio,
    playAudio,
    markStale,
    restoreState,
    loadState,
    collectAll,
  };
})();
