/**
 * VoiceSettingsManager.js
 * Manages the Voice Selection & Preview tab in company-profile.html
 *
 * API:
 *   GET  /api/company/:id/v2-voice-settings/voices  → list of voices
 *   GET  /api/company/:id/v2-voice-settings          → current settings
 *   POST /api/company/:id/v2-voice-settings          → save settings
 */
class VoiceSettingsManager {
    constructor(companyId) {
        this.companyId = companyId;
        this.voices = [];
        this.filteredVoices = [];
        this.currentSettings = null;
        this.initialized = false;
        this._previewUrl = null;
        this._debounceTimer = null;
        this._saveTimer = null;
        this.els = {};
    }

    async initialize() {
        if (this.initialized) return;
        this.initialized = true;
        console.debug('[VoiceSettingsManager] Initializing for company:', this.companyId);
        this._bindElements();
        this._bindEvents();
        await Promise.all([this._loadSettings(), this._loadVoices()]);
    }

    _bindElements() {
        const $ = (id) => document.getElementById(id);
        this.els = {
            selector:        $('voice-selector'),
            genderFilter:    $('voice-gender-filter'),
            categoryFilter:  $('voice-category-filter'),
            refreshBtn:      $('refresh-voices'),
            previewSection:  $('voice-preview-section'),
            voiceInfo:       $('voice-info'),
            playBtn:         $('play-voice-sample'),
            previewAudio:    $('voice-preview-audio'),
            currentName:     $('current-voice-name'),
            saveIndicator:   $('voice-save-indicator'),
            stabilityRange:  $('voice-stability'),
            stabilityVal:    $('stability-value'),
            similarityRange: $('voice-similarity'),
            similarityVal:   $('similarity-value'),
            styleRange:      $('voice-style'),
            styleVal:        $('style-value'),
            speakerBoost:    $('voice-speaker-boost'),
            modelSelect:     $('voice-model'),
            resetBtn:        $('reset-voice-settings'),
        };
    }

    _bindEvents() {
        const { selector, genderFilter, categoryFilter, refreshBtn, playBtn, resetBtn,
                stabilityRange, similarityRange, styleRange, speakerBoost, modelSelect } = this.els;

        if (refreshBtn)     refreshBtn.addEventListener('click',  () => this._loadVoices(true));
        if (genderFilter)   genderFilter.addEventListener('change', () => this._applyFilters());
        if (categoryFilter) categoryFilter.addEventListener('change', () => this._applyFilters());
        if (selector)       selector.addEventListener('change', () => this._onVoiceSelected());
        if (playBtn)        playBtn.addEventListener('click', () => this._playPreview());
        if (resetBtn)       resetBtn.addEventListener('click', () => this._resetAdvancedSettings());

        if (stabilityRange)  stabilityRange.addEventListener('input', () => {
            if (this.els.stabilityVal) this.els.stabilityVal.textContent = stabilityRange.value;
            this._debouncedSave();
        });
        if (similarityRange) similarityRange.addEventListener('input', () => {
            if (this.els.similarityVal) this.els.similarityVal.textContent = similarityRange.value;
            this._debouncedSave();
        });
        if (styleRange) styleRange.addEventListener('input', () => {
            if (this.els.styleVal) this.els.styleVal.textContent = styleRange.value;
            this._debouncedSave();
        });
        if (speakerBoost) speakerBoost.addEventListener('change', () => this._debouncedSave());
        if (modelSelect)  modelSelect.addEventListener('change',  () => this._debouncedSave());
    }

    _authHeaders() {
        const token = localStorage.getItem('adminToken') || localStorage.getItem('token') || '';
        return {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        };
    }

    async _loadSettings() {
        try {
            const res = await fetch(`/api/company/${this.companyId}/v2-voice-settings`, { headers: this._authHeaders() });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            this.currentSettings = data.settings || {};
            this._populateAdvancedSettings(this.currentSettings);
            console.debug('[VoiceSettingsManager] Settings loaded:', this.currentSettings);
        } catch (err) {
            console.warn('[VoiceSettingsManager] Could not load settings:', err.message);
            this.currentSettings = {};
        }
    }

    async _loadVoices(forceRefresh = false) {
        const { selector, refreshBtn } = this.els;
        if (!selector) return;
        selector.innerHTML = '<option value="">Loading voices\u2026</option>';
        selector.disabled = true;
        if (refreshBtn) refreshBtn.disabled = true;
        try {
            const url = `/api/company/${this.companyId}/v2-voice-settings/voices${forceRefresh ? '?refresh=1' : ''}`;
            const res = await fetch(url, { headers: this._authHeaders() });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.message || `HTTP ${res.status}`);
            }
            const data = await res.json();
            this.voices = Array.isArray(data) ? data : (data.voices || []);
            console.debug(`[VoiceSettingsManager] Loaded ${this.voices.length} voices`);
            this._applyFilters();
            this._restoreSavedVoice();
        } catch (err) {
            console.error('[VoiceSettingsManager] Failed to load voices:', err.message);
            selector.innerHTML = `<option value="">\u26a0\ufe0f ${err.message || 'Failed to load voices'}</option>`;
        } finally {
            selector.disabled = false;
            if (refreshBtn) refreshBtn.disabled = false;
        }
    }

    _applyFilters() {
        const gender   = this.els.genderFilter?.value?.toLowerCase()   || '';
        const category = this.els.categoryFilter?.value?.toLowerCase() || '';
        this.filteredVoices = this.voices.filter(v => {
            const vg = (v.labels?.gender   || v.gender   || '').toLowerCase();
            const vc = (v.labels?.category || v.category || '').toLowerCase();
            if (gender   && vg !== gender)           return false;
            if (category && !vc.includes(category))  return false;
            return true;
        });
        this._renderVoiceOptions();
    }

    _renderVoiceOptions() {
        const { selector } = this.els;
        if (!selector) return;
        const savedVoiceId = this.currentSettings?.voiceId || '';
        selector.innerHTML = '<option value="">Choose a voice\u2026</option>';
        this.filteredVoices.forEach(v => {
            const id       = v.voice_id || v.id || '';
            const name     = v.name || v.displayName || id;
            const gender   = v.labels?.gender   || v.gender   || '';
            const category = v.labels?.category || v.category || '';
            const label    = [name, gender, category].filter(Boolean).join(' \u00b7 ');
            const opt      = document.createElement('option');
            opt.value       = id;
            opt.textContent = label;
            if (id === savedVoiceId) opt.selected = true;
            selector.appendChild(opt);
        });
    }

    _restoreSavedVoice() {
        const savedVoiceId = this.currentSettings?.voiceId || '';
        if (!savedVoiceId) return;
        const voice = this.voices.find(v => (v.voice_id || v.id) === savedVoiceId);
        if (voice) {
            this._displayVoiceInfo(voice);
            const name = voice.name || voice.displayName || savedVoiceId;
            if (this.els.currentName) this.els.currentName.textContent = name;
        }
    }

    _onVoiceSelected() {
        const voiceId = this.els.selector?.value;
        if (!voiceId) { this._hidePreview(); return; }
        const voice = this.voices.find(v => (v.voice_id || v.id) === voiceId);
        if (voice) this._displayVoiceInfo(voice);
        this._saveSettings({ voiceId });
    }

    _displayVoiceInfo(voice) {
        const { voiceInfo, previewSection } = this.els;
        if (!voiceInfo || !previewSection) return;
        const name     = voice.name || voice.displayName || '';
        const gender   = voice.labels?.gender   || voice.gender   || '';
        const category = voice.labels?.category || voice.category || '';
        const accent   = voice.labels?.accent   || '';
        const desc     = voice.description || '';
        voiceInfo.innerHTML = `
            <div class="space-y-1">
                <p class="font-semibold text-gray-800">${this._esc(name)}</p>
                <p class="text-xs text-gray-500">
                    ${gender   ? `<span class="inline-block bg-blue-100 text-blue-700 rounded px-1 mr-1">${this._esc(gender)}</span>` : ''}
                    ${category ? `<span class="inline-block bg-purple-100 text-purple-700 rounded px-1 mr-1">${this._esc(category)}</span>` : ''}
                    ${accent   ? `<span class="inline-block bg-green-100 text-green-700 rounded px-1">${this._esc(accent)}</span>` : ''}
                </p>
                ${desc ? `<p class="text-xs text-gray-400 mt-1">${this._esc(desc)}</p>` : ''}
            </div>`;
        this._previewUrl = voice.preview_url || voice.previewUrl || voice.preview || (voice.samples && voice.samples[0] && (voice.samples[0].url || voice.samples[0].audio_url)) || null;
        previewSection.classList.remove('hidden');
    }

    _hidePreview() {
        if (this.els.previewSection) this.els.previewSection.classList.add('hidden');
        this._previewUrl = null;
    }

    _playPreview() {
        const { previewAudio, playBtn } = this.els;
        if (!previewAudio || !this._previewUrl) {
            console.warn('[VoiceSettingsManager] No preview URL available');
            return;
        }
        previewAudio.src = this._previewUrl;
        previewAudio.classList.remove('hidden');
        previewAudio.play().catch(err => console.warn('[VoiceSettingsManager] Audio error:', err));
        if (playBtn) {
            playBtn.innerHTML = '<i class="fas fa-pause mr-1"></i>Playing\u2026';
            playBtn.disabled = true;
            previewAudio.onended = () => {
                playBtn.innerHTML = '<i class="fas fa-play mr-1"></i>Play Sample';
                playBtn.disabled = false;
            };
        }
    }

    _populateAdvancedSettings(s) {
        if (!s) return;
        const { stabilityRange, stabilityVal, similarityRange, similarityVal,
                styleRange, styleVal, speakerBoost, modelSelect } = this.els;
        if (stabilityRange  && s.stability         !== undefined) { stabilityRange.value  = s.stability;         if (stabilityVal)  stabilityVal.textContent  = s.stability; }
        if (similarityRange && s.similarityBoost    !== undefined) { similarityRange.value = s.similarityBoost;   if (similarityVal) similarityVal.textContent = s.similarityBoost; }
        if (styleRange      && s.styleExaggeration  !== undefined) { styleRange.value      = s.styleExaggeration; if (styleVal)      styleVal.textContent      = s.styleExaggeration; }
        if (speakerBoost    && s.speakerBoost       !== undefined) { speakerBoost.checked  = s.speakerBoost; }
        if (modelSelect     && s.aiModel)                         { modelSelect.value     = s.aiModel; }
    }

    _resetAdvancedSettings() {
        const d = { stability: 0.5, similarityBoost: 0.7, styleExaggeration: 0.0, speakerBoost: true, aiModel: 'eleven_turbo_v2_5' };
        this._populateAdvancedSettings(d);
        this._saveSettings(d);
    }

    _buildPayload() {
        const { stabilityRange, similarityRange, styleRange, speakerBoost, modelSelect, selector } = this.els;
        return {
            voiceId:           selector?.value         || this.currentSettings?.voiceId || null,
            stability:         parseFloat(stabilityRange?.value  ?? 0.5),
            similarityBoost:   parseFloat(similarityRange?.value ?? 0.7),
            styleExaggeration: parseFloat(styleRange?.value      ?? 0.0),
            speakerBoost:      speakerBoost?.checked   ?? true,
            aiModel:           modelSelect?.value      || 'eleven_turbo_v2_5',
        };
    }

    async _saveSettings(overrides = {}) {
        const payload = { ...this._buildPayload(), ...overrides };
        try {
            const res = await fetch(`/api/company/${this.companyId}/v2-voice-settings`, {
                method: 'POST',
                headers: this._authHeaders(),
                body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            this.currentSettings = data.settings || payload;
            if (payload.voiceId) {
                const voice = this.voices.find(v => (v.voice_id || v.id) === payload.voiceId);
                const name = voice ? (voice.name || voice.displayName) : payload.voiceId;
                if (this.els.currentName) this.els.currentName.textContent = name;
            }
            this._flashSaved();
            console.debug('[VoiceSettingsManager] Saved:', payload);
        } catch (err) {
            console.error('[VoiceSettingsManager] Save failed:', err.message);
        }
    }

    _flashSaved() {
        const { saveIndicator } = this.els;
        if (!saveIndicator) return;
        saveIndicator.classList.remove('hidden');
        clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => saveIndicator.classList.add('hidden'), 2500);
    }

    _debouncedSave() {
        clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => this._saveSettings(), 800);
    }

    _esc(str) {
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
}

// Required by company-profile-modern.js
window.VoiceSettingsManager = VoiceSettingsManager;
