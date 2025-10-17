/**
 * ═══════════════════════════════════════════════════════════════════════
 * AI VOICE SETTINGS MANAGER - V2 ELEVENLABS INTEGRATION
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * Complete voice configuration system for AI Voice Settings tab.
 * 
 * Features:
 * - Voice selection with real-time preview
 * - Instant voice testing (Play Sample button)
 * - Full TTS testing with custom text
 * - Advanced voice parameter controls
 * - Download generated audio
 * - Real-time voice info display
 * 
 * Architecture:
 * - Uses v2-voice-settings API endpoints
 * - Multi-tenant isolation (per company)
 * - Supports both global ClientsVia API and custom company API keys
 * - Production-grade error handling
 * 
 * @version 2.0
 */

class VoiceSettingsManager {
    constructor(companyId) {
        this.companyId = companyId;
        this.voices = [];
        this.selectedVoice = null;
        this.currentSettings = null;
        this.initialized = false;
    }

    /**
     * Initialize the Voice Settings Manager
     */
    async initialize() {
        if (this.initialized) return;
        
        console.log('🎤 [VOICE MANAGER] Initializing...');
        
        try {
            // Load voices and current settings in parallel
            await Promise.all([
                this.loadVoices(),
                this.loadCurrentSettings()
            ]);
            
            // Attach all event listeners
            this.attachEventListeners();
            
            this.initialized = true;
            console.log('✅ [VOICE MANAGER] Initialized successfully');
            
        } catch (error) {
            console.error('❌ [VOICE MANAGER] Initialization failed:', error);
        }
    }

    /**
     * Load available voices from ElevenLabs
     */
    async loadVoices() {
        try {
            const token = localStorage.getItem('adminToken');
            
            console.log('🎤 [VOICE MANAGER] Loading voices...');
            
            const response = await fetch(`/api/company/${this.companyId}/v2-voice-settings/voices`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            this.voices = data.voices || [];
            
            console.log(`✅ [VOICE MANAGER] Loaded ${this.voices.length} voices`);
            
            // Populate dropdown
            this.populateVoiceDropdown();
            
        } catch (error) {
            console.error('❌ [VOICE MANAGER] Failed to load voices:', error);
            const voiceSelector = document.getElementById('voice-selector');
            if (voiceSelector) {
                voiceSelector.innerHTML = '<option value="">Error loading voices - please refresh</option>';
            }
        }
    }

    /**
     * Populate voice dropdown with loaded voices
     */
    populateVoiceDropdown() {
        const voiceSelector = document.getElementById('voice-selector');
        if (!voiceSelector) return;
        
        voiceSelector.innerHTML = '<option value="">Choose a voice...</option>';
        
        this.voices.forEach(voice => {
            const option = document.createElement('option');
            option.value = voice.voice_id;
            option.textContent = voice.name;
            option.dataset.gender = voice.labels?.gender || '';
            option.dataset.category = voice.labels?.category || '';
            option.dataset.previewUrl = voice.preview_url || '';
            voiceSelector.appendChild(option);
        });
        
        // Select current voice if available
        if (this.currentSettings?.voiceId) {
            voiceSelector.value = this.currentSettings.voiceId;
            this.onVoiceSelected(this.currentSettings.voiceId);
        }
    }

    /**
     * Load current voice settings from database
     */
    async loadCurrentSettings() {
        try {
            const token = localStorage.getItem('adminToken');
            
            const response = await fetch(`/api/company/${this.companyId}/v2-voice-settings`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            this.currentSettings = data.settings;
            
            console.log('✅ [VOICE MANAGER] Loaded current settings');
            
            // Populate form fields with current settings
            this.populateFormFields();
            
        } catch (error) {
            console.error('❌ [VOICE MANAGER] Failed to load settings:', error);
        }
    }

    /**
     * Populate form fields with current settings
     */
    populateFormFields() {
        if (!this.currentSettings) return;
        
        const fields = {
            'voice-stability': this.currentSettings.stability,
            'voice-similarity': this.currentSettings.similarityBoost,
            'voice-style': this.currentSettings.styleExaggeration,
            'voice-model': this.currentSettings.aiModel,
            'voice-latency': this.currentSettings.streamingLatency
        };
        
        Object.keys(fields).forEach(fieldId => {
            const field = document.getElementById(fieldId);
            if (field) {
                field.value = fields[fieldId];
                
                // Update slider value displays
                if (field.type === 'range') {
                    const valueName = fieldId.replace('voice-', '');
                    this.updateSliderDisplay(valueName, fields[fieldId]);
                }
            }
        });
        
        // Update speaker boost checkbox
        const speakerBoost = document.getElementById('voice-speaker-boost');
        if (speakerBoost) {
            speakerBoost.checked = this.currentSettings.speakerBoost || false;
        }
        
        // Update API source toggle and API key
        const useOwnApiToggle = document.getElementById('useOwnApiKey');
        const apiKeyInput = document.getElementById('elevenlabsApiKey');
        
        if (this.currentSettings.apiSource === 'own') {
            // Enable "Use Own API" toggle
            if (useOwnApiToggle) {
                useOwnApiToggle.checked = true;
            }
            
            // Load API key (will be masked by backend for security)
            if (apiKeyInput && this.currentSettings.apiKey) {
                apiKeyInput.value = this.currentSettings.apiKey;
            }
            
            // Show API key section
            this.toggleApiKeySection(true);
            
            console.log('🔑 [VOICE MANAGER] Loaded settings with custom API key');
        } else {
            // Ensure toggle is OFF and section is hidden
            if (useOwnApiToggle) {
                useOwnApiToggle.checked = false;
            }
            this.toggleApiKeySection(false);
            
            console.log('🌐 [VOICE MANAGER] Loaded settings with ClientsVia global API');
        }
    }

    /**
     * Attach all event listeners
     */
    attachEventListeners() {
        // Voice selection
        const voiceSelector = document.getElementById('voice-selector');
        if (voiceSelector) {
            voiceSelector.addEventListener('change', (e) => {
                this.onVoiceSelected(e.target.value);
            });
        }
        
        // Refresh voices button
        const refreshBtn = document.getElementById('refresh-voices');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                console.log('🔄 [VOICE MANAGER] Refreshing voices...');
                this.loadVoices();
            });
        }
        
        // Play voice sample button
        const playSampleBtn = document.getElementById('play-voice-sample');
        if (playSampleBtn) {
            playSampleBtn.addEventListener('click', () => {
                this.playVoiceSample();
            });
        }
        
        // Generate test audio button
        const testVoiceBtn = document.getElementById('test-voice-btn');
        if (testVoiceBtn) {
            testVoiceBtn.addEventListener('click', () => {
                this.generateTestAudio();
            });
        }
        
        // Stream test button
        const streamTestBtn = document.getElementById('stream-test-btn');
        if (streamTestBtn) {
            streamTestBtn.addEventListener('click', () => {
                this.streamTest();
            });
        }
        
        // Save settings button
        const saveBtn = document.getElementById('save-voice-settings');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                this.saveSettings();
            });
        }
        
        // Reset to optimal button
        const resetBtn = document.getElementById('reset-voice-settings');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                this.resetToOptimal();
            });
        }
        
        // Use Own API toggle
        const useOwnApiToggle = document.getElementById('useOwnApiKey');
        if (useOwnApiToggle) {
            useOwnApiToggle.addEventListener('change', (e) => {
                this.toggleApiKeySection(e.target.checked);
            });
        }
        
        // Slider updates
        const sliders = ['stability', 'similarity', 'style'];
        sliders.forEach(name => {
            const slider = document.getElementById(`voice-${name}`);
            if (slider) {
                slider.addEventListener('input', (e) => {
                    this.updateSliderDisplay(name, e.target.value);
                });
            }
        });
    }

    /**
     * Toggle API key section visibility
     */
    toggleApiKeySection(useOwnApi) {
        const apiKeySection = document.getElementById('api-key-section');
        const apiKeyInput = document.getElementById('elevenlabsApiKey');
        const globalApiInfo = document.getElementById('global-api-info');
        const subscriptionInfo = document.getElementById('subscription-info');
        
        if (useOwnApi) {
            // Show API key input
            if (apiKeySection) apiKeySection.classList.remove('hidden');
            if (apiKeyInput) apiKeyInput.disabled = false;
            if (subscriptionInfo) subscriptionInfo.classList.remove('hidden');
            
            // Hide global API info
            if (globalApiInfo) globalApiInfo.classList.add('hidden');
            
            console.log('🔑 [VOICE MANAGER] Switched to Own API mode');
        } else {
            // Hide API key input
            if (apiKeySection) apiKeySection.classList.add('hidden');
            if (apiKeyInput) {
                apiKeyInput.disabled = true;
                apiKeyInput.value = ''; // Clear API key when switching back
            }
            if (subscriptionInfo) subscriptionInfo.classList.add('hidden');
            
            // Show global API info
            if (globalApiInfo) globalApiInfo.classList.remove('hidden');
            
            console.log('🌐 [VOICE MANAGER] Switched to ClientsVia Global API mode');
        }
    }

    /**
     * Handle voice selection
     */
    onVoiceSelected(voiceId) {
        if (!voiceId) {
            this.hideVoicePreview();
            return;
        }
        
        this.selectedVoice = this.voices.find(v => v.voice_id === voiceId);
        
        if (this.selectedVoice) {
            console.log('🎤 [VOICE MANAGER] Voice selected:', this.selectedVoice.name);
            this.showVoicePreview(this.selectedVoice);
        }
    }

    /**
     * Show voice preview section with voice details
     */
    showVoicePreview(voice) {
        const previewSection = document.getElementById('voice-preview-section');
        const voiceInfo = document.getElementById('voice-info');
        
        if (!previewSection || !voiceInfo) return;
        
        // Build voice info HTML
        const gender = voice.labels?.gender || 'Unknown';
        const category = voice.labels?.category || 'General';
        const accent = voice.labels?.accent || 'N/A';
        const age = voice.labels?.age || 'N/A';
        
        voiceInfo.innerHTML = `
            <div class="text-sm space-y-1">
                <div class="flex items-center justify-between">
                    <span class="font-semibold text-gray-700">${voice.name}</span>
                    <span class="px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs">${gender}</span>
                </div>
                <div class="grid grid-cols-2 gap-2 text-xs text-gray-600">
                    <div><strong>Category:</strong> ${category}</div>
                    <div><strong>Accent:</strong> ${accent}</div>
                    <div><strong>Age:</strong> ${age}</div>
                    <div><strong>ID:</strong> <code class="text-xs">${voice.voice_id.substring(0, 8)}...</code></div>
                </div>
            </div>
        `;
        
        previewSection.classList.remove('hidden');
    }

    /**
     * Hide voice preview section
     */
    hideVoicePreview() {
        const previewSection = document.getElementById('voice-preview-section');
        if (previewSection) {
            previewSection.classList.add('hidden');
        }
    }

    /**
     * Play voice sample (uses voice's preview URL from ElevenLabs)
     */
    async playVoiceSample() {
        if (!this.selectedVoice) {
            alert('⚠️ Please select a voice first');
            return;
        }
        
        const playSampleBtn = document.getElementById('play-voice-sample');
        const audio = document.getElementById('voice-preview-audio');
        
        if (!audio) return;
        
        try {
            playSampleBtn.disabled = true;
            playSampleBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Loading...';
            
            console.log('🎵 [VOICE MANAGER] Playing voice sample...');
            
            // Use preview URL if available, otherwise generate a short sample
            if (this.selectedVoice.preview_url) {
                audio.src = this.selectedVoice.preview_url;
                audio.classList.remove('hidden');
                await audio.play();
            } else {
                // Generate a quick sample using ElevenLabs
                await this.generateQuickSample();
            }
            
        } catch (error) {
            console.error('❌ [VOICE MANAGER] Failed to play sample:', error);
            alert('Failed to play voice sample: ' + error.message);
        } finally {
            playSampleBtn.disabled = false;
            playSampleBtn.innerHTML = '<i class="fas fa-play mr-1"></i>Play Sample';
        }
    }

    /**
     * Generate a quick sample using ElevenLabs TTS
     */
    async generateQuickSample() {
        const token = localStorage.getItem('adminToken');
        const text = "Hello! Thanks for calling. How can I help you today?";
        
        const response = await fetch(`/api/company/${this.companyId}/v2-tts/generate`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                text,
                voiceId: this.selectedVoice.voice_id
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        
        const audio = document.getElementById('voice-preview-audio');
        audio.src = url;
        audio.classList.remove('hidden');
        await audio.play();
    }

    /**
     * Generate test audio with custom text
     */
    async generateTestAudio() {
        const voiceSelector = document.getElementById('voice-selector');
        const testText = document.getElementById('test-text');
        const testResults = document.getElementById('test-results');
        const testBtn = document.getElementById('test-voice-btn');
        
        if (!voiceSelector?.value) {
            alert('⚠️ Please select a voice first');
            return;
        }
        
        if (!testText?.value.trim()) {
            alert('⚠️ Please enter test text');
            return;
        }
        
        try {
            testBtn.disabled = true;
            testBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Generating Audio...';
            
            testResults.innerHTML = `
                <div class="text-center text-blue-600 py-8">
                    <i class="fas fa-spinner fa-spin text-2xl mb-2"></i>
                    <p>Generating audio with ElevenLabs...</p>
                </div>
            `;
            
            console.log('🎵 [VOICE MANAGER] Generating test audio...');
            
            const token = localStorage.getItem('adminToken');
            
            // Get current slider values for testing
            const stability = document.getElementById('voice-stability')?.value || 0.5;
            const similarityBoost = document.getElementById('voice-similarity')?.value || 0.7;
            const styleExaggeration = document.getElementById('voice-style')?.value || 0.0;
            const model = document.getElementById('voice-model')?.value || 'eleven_turbo_v2_5';
            
            const response = await fetch(`/api/company/${this.companyId}/v2-tts/generate`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    text: testText.value.trim(),
                    voiceId: voiceSelector.value,
                    stability: parseFloat(stability),
                    similarity_boost: parseFloat(similarityBoost),
                    style: parseFloat(styleExaggeration),
                    model_id: model
                })
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }
            
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            
            // Show audio player with download button
            testResults.innerHTML = `
                <div class="space-y-3">
                    <div class="flex items-center justify-between">
                        <span class="text-sm font-medium text-gray-700">
                            <i class="fas fa-check-circle text-green-600 mr-2"></i>
                            Audio generated successfully!
                        </span>
                        <span class="text-xs text-gray-500">
                            ${(blob.size / 1024).toFixed(1)} KB
                        </span>
                    </div>
                    
                    <audio controls class="w-full" autoplay>
                        <source src="${url}" type="audio/mpeg">
                        Your browser does not support audio playback.
                    </audio>
                    
                    <div class="flex items-center justify-end space-x-2">
                        <a href="${url}" download="voice-test-${Date.now()}.mp3" 
                           class="text-sm bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded transition duration-150">
                            <i class="fas fa-download mr-1"></i>Download Audio
                        </a>
                    </div>
                    
                    <div class="text-xs text-gray-500 border-t pt-2">
                        <strong>Settings used:</strong> Stability: ${stability}, Similarity: ${similarityBoost}, Style: ${styleExaggeration}, Model: ${model}
                    </div>
                </div>
            `;
            
            console.log('✅ [VOICE MANAGER] Test audio generated successfully');
            
        } catch (error) {
            console.error('❌ [VOICE MANAGER] Failed to generate test audio:', error);
            testResults.innerHTML = `
                <div class="text-center text-red-600 py-8">
                    <i class="fas fa-exclamation-triangle text-2xl mb-2"></i>
                    <p class="font-semibold">Generation Failed</p>
                    <p class="text-sm mt-2">${error.message}</p>
                </div>
            `;
        } finally {
            testBtn.disabled = false;
            testBtn.innerHTML = '<i class="fas fa-play mr-2"></i>Generate Test Audio';
        }
    }

    /**
     * Stream test (real-time streaming audio)
     */
    async streamTest() {
        alert('🚧 Stream testing feature coming soon!\n\nThis will demonstrate real-time audio streaming for ultra-low latency voice responses.');
    }

    /**
     * Save voice settings to database
     */
    async saveSettings() {
        const voiceSelector = document.getElementById('voice-selector');
        const saveBtn = document.getElementById('save-voice-settings');
        
        if (!voiceSelector?.value) {
            alert('⚠️ Please select a voice first');
            return;
        }
        
        try {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...';
            
            console.log('💾 [VOICE MANAGER] Saving settings...');
            
            // Check if using own API
            const useOwnApiToggle = document.getElementById('useOwnApiKey');
            const useOwnApi = useOwnApiToggle?.checked || false;
            
            // Collect all form values
            const settings = {
                voiceId: voiceSelector.value,
                stability: parseFloat(document.getElementById('voice-stability')?.value || 0.5),
                similarityBoost: parseFloat(document.getElementById('voice-similarity')?.value || 0.7),
                styleExaggeration: parseFloat(document.getElementById('voice-style')?.value || 0.0),
                speakerBoost: document.getElementById('voice-speaker-boost')?.checked || true,
                aiModel: document.getElementById('voice-model')?.value || 'eleven_turbo_v2_5',
                outputFormat: document.getElementById('voice-format')?.value || 'mp3_44100_128',
                streamingLatency: parseInt(document.getElementById('voice-latency')?.value || 0),
                apiSource: useOwnApi ? 'own' : 'clientsvia'
            };
            
            // If using own API, get and validate the API key
            if (useOwnApi) {
                const apiKeyInput = document.getElementById('elevenlabsApiKey');
                const apiKey = apiKeyInput?.value?.trim();
                
                if (!apiKey) {
                    alert('⚠️ Please enter your ElevenLabs API key');
                    saveBtn.disabled = false;
                    saveBtn.innerHTML = '<i class="fas fa-save mr-2"></i>Save Voice Settings';
                    return;
                }
                
                settings.apiKey = apiKey;
                console.log('🔑 [VOICE MANAGER] Using customer\'s own ElevenLabs API key');
            } else {
                console.log('🌐 [VOICE MANAGER] Using ClientsVia global API');
            }
            
            const token = localStorage.getItem('adminToken');
            
            const response = await fetch(`/api/company/${this.companyId}/v2-voice-settings`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(settings)
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || `HTTP ${response.status}`);
            }
            
            const data = await response.json();
            this.currentSettings = data.settings;
            
            console.log('✅ [VOICE MANAGER] Settings saved successfully');
            
            // Show success message
            saveBtn.innerHTML = '<i class="fas fa-check mr-2"></i>Saved!';
            saveBtn.classList.remove('bg-indigo-600', 'hover:bg-indigo-700');
            saveBtn.classList.add('bg-green-600');
            
            setTimeout(() => {
                saveBtn.innerHTML = '<i class="fas fa-save mr-2"></i>Save Voice Settings';
                saveBtn.classList.remove('bg-green-600');
                saveBtn.classList.add('bg-indigo-600', 'hover:bg-indigo-700');
                saveBtn.disabled = false;
            }, 2000);
            
        } catch (error) {
            console.error('❌ [VOICE MANAGER] Failed to save settings:', error);
            alert('Failed to save settings: ' + error.message);
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i class="fas fa-save mr-2"></i>Save Voice Settings';
        }
    }

    /**
     * Reset settings to optimal defaults
     */
    resetToOptimal() {
        if (!confirm('Reset all voice settings to optimal defaults?')) {
            return;
        }
        
        const defaults = {
            'voice-stability': 0.5,
            'voice-similarity': 0.7,
            'voice-style': 0.0,
            'voice-latency': 0,
            'voice-speaker-boost': true,
            'voice-model': 'eleven_turbo_v2_5',
            'voice-format': 'mp3_44100_128'
        };
        
        Object.keys(defaults).forEach(fieldId => {
            const field = document.getElementById(fieldId);
            if (field) {
                if (field.type === 'checkbox') {
                    field.checked = defaults[fieldId];
                } else {
                    field.value = defaults[fieldId];
                    
                    // Update slider displays
                    if (field.type === 'range') {
                        const valueName = fieldId.replace('voice-', '');
                        this.updateSliderDisplay(valueName, defaults[fieldId]);
                    }
                }
            }
        });
        
        console.log('🔄 [VOICE MANAGER] Settings reset to optimal defaults');
    }

    /**
     * Update slider value display
     */
    updateSliderDisplay(name, value) {
        const displayElement = document.getElementById(`${name}-value`);
        if (displayElement) {
            displayElement.textContent = parseFloat(value).toFixed(1);
        }
    }
}

// Export for use in company-profile.html
window.VoiceSettingsManager = VoiceSettingsManager;

