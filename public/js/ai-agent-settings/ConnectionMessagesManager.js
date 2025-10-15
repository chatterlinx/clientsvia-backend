/**
 * ============================================================================
 * CONNECTION MESSAGES MANAGER
 * ============================================================================
 * 
 * Manages multi-channel connection messages:
 * - Voice: Pre-recorded audio upload OR real-time TTS
 * - SMS: Auto-reply text messages
 * - Web Chat: Auto-reply messages (future)
 * 
 * PURPOSE: First-touch messages sent BEFORE AI agent engages
 * 
 * ============================================================================
 */

class ConnectionMessagesManager {
    constructor(companyId) {
        this.companyId = companyId;
        this.initialized = false;
        this.config = null;
        this.currentChannel = 'voice'; // voice | sms | webchat
        this.voiceSettings = null; // Voice settings from AI Voice Settings tab
    }

    /**
     * Initialize the Connection Messages Manager
     */
    async initialize() {
        if (this.initialized) return;

        console.log('📞 [CONNECTION MESSAGES] Initializing...');

        try {
            await Promise.all([
                this.loadConfig(),
                this.loadVoiceSettings()
            ]);
            this.render();
            this.initialized = true;

            console.log('✅ [CONNECTION MESSAGES] Initialized successfully');
        } catch (error) {
            console.error('❌ [CONNECTION MESSAGES] Initialization failed:', error);
            this.renderError('Failed to load connection messages configuration');
        }
    }

    /**
     * Load configuration from backend
     */
    async loadConfig() {
        const token = localStorage.getItem('adminToken');

        const response = await fetch(`/api/company/${this.companyId}/connection-messages/config`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        this.config = await response.json();

        console.log('📞 [CONNECTION MESSAGES] Config loaded:', this.config);
    }

    /**
     * Load voice settings from AI Voice Settings tab
     */
    async loadVoiceSettings() {
        try {
            const token = localStorage.getItem('adminToken');
            const response = await fetch(`/api/company/${this.companyId}/v2-voice-settings`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.ok) {
                const data = await response.json();
                this.voiceSettings = data;
                console.log('📞 [CONNECTION MESSAGES] Loaded voice settings from AI Voice Settings tab');
                console.log('📞 Selected voice:', data.selectedVoice || 'Not configured');
            } else {
                console.warn('📞 [CONNECTION MESSAGES] Could not load voice settings');
                this.voiceSettings = null;
            }
        } catch (error) {
            console.warn('📞 [CONNECTION MESSAGES] Error loading voice settings:', error);
            this.voiceSettings = null;
        }
    }

    /**
     * Render the complete UI
     */
    render() {
        const container = document.getElementById('connection-messages-container');
        if (!container) {
            console.error('❌ [CONNECTION MESSAGES] Container not found');
            return;
        }

        container.innerHTML = `
            ${this.renderHeader()}
            ${this.renderChannelSelector()}
            ${this.renderChannelContent()}
            ${this.renderSaveButtons()}
        `;

        // Attach event listeners
        this.attachEventListeners();
    }

    /**
     * Render header with description
     */
    renderHeader() {
        return `
            <div class="telephony-section">
                <h3>
                    <i class="fas fa-comments"></i>
                    Connection Messages
                </h3>
                <p>
                    These messages are sent instantly when a customer connects, <strong>before the AI agent begins processing</strong>.
                    Configure different messages for each communication channel.
                </p>
            </div>
        `;
    }

    /**
     * Render channel selector
     */
    renderChannelSelector() {
        return `
            <div class="message-channel-selector">
                <div class="channel-option ${this.currentChannel === 'voice' ? 'active' : ''}" data-channel="voice">
                    <i class="fas fa-phone"></i>
                    <h4>Voice Calls</h4>
                    <p>Pre-recorded or TTS greeting</p>
                </div>
                <div class="channel-option ${this.currentChannel === 'sms' ? 'active' : ''}" data-channel="sms">
                    <i class="fas fa-sms"></i>
                    <h4>SMS Messages</h4>
                    <p>Instant text auto-reply</p>
                </div>
                <div class="channel-option ${this.currentChannel === 'webchat' ? 'active' : ''}" data-channel="webchat" style="opacity: 0.6;">
                    <i class="fas fa-comments"></i>
                    <h4>Web Chat</h4>
                    <p>Coming soon</p>
                </div>
            </div>
        `;
    }

    /**
     * Render content for selected channel
     */
    renderChannelContent() {
        switch (this.currentChannel) {
            case 'voice':
                return this.renderVoiceContent();
            case 'sms':
                return this.renderSMSContent();
            case 'webchat':
                return this.renderWebChatContent();
            default:
                return '';
        }
    }

    /**
     * Render voice channel content
     */
    renderVoiceContent() {
        const voice = this.config?.voice || {};
        const mode = voice.mode || 'prerecorded';

        return `
            <div class="telephony-section">
                <h3>🎵 Voice Connection Message</h3>
                <p style="margin-bottom: 24px;">Choose how callers hear your initial greeting:</p>

                <div class="radio-option-group">
                    
                    <!-- Option 1: Pre-recorded Audio -->
                    <div class="radio-option-card ${mode === 'prerecorded' ? 'selected' : ''}" data-mode="prerecorded">
                        <div class="radio-option-header">
                            <input type="radio" name="voice-mode" value="prerecorded" ${mode === 'prerecorded' ? 'checked' : ''} id="mode-prerecorded">
                            <label for="mode-prerecorded">
                                Play Pre-Recorded Audio
                                <span class="badge-recommended">💰 Recommended</span>
                            </label>
                        </div>
                        <div class="radio-option-body">
                            <p class="radio-option-description">
                                Upload or generate a single audio file that plays for every call. 
                                <strong>Saves money</strong> by avoiding ElevenLabs API costs per call.
                            </p>

                            ${this.renderPrerecordedSection(voice.prerecorded)}
                        </div>
                    </div>

                    <!-- Option 2: Real-time TTS -->
                    <div class="radio-option-card ${mode === 'realtime' ? 'selected' : ''}" data-mode="realtime">
                        <div class="radio-option-header">
                            <input type="radio" name="voice-mode" value="realtime" ${mode === 'realtime' ? 'checked' : ''} id="mode-realtime">
                            <label for="mode-realtime">
                                Generate from Text (Real-time TTS)
                                <span class="badge-cost-warning">⚠️ Costs per call</span>
                            </label>
                        </div>
                        <div class="radio-option-body">
                            <p class="radio-option-description">
                                Generate audio in real-time for each call using ElevenLabs. 
                                More flexible but incurs API costs (~$0.03 per call).
                            </p>

                            ${this.renderRealtimeSection(voice.realtime)}
                        </div>
                    </div>

                    <!-- Option 3: Disabled -->
                    <div class="radio-option-card ${mode === 'disabled' ? 'selected' : ''}" data-mode="disabled">
                        <div class="radio-option-header">
                            <input type="radio" name="voice-mode" value="disabled" ${mode === 'disabled' ? 'checked' : ''} id="mode-disabled">
                            <label for="mode-disabled">
                                Disabled (Skip straight to AI)
                            </label>
                        </div>
                        <div class="radio-option-body">
                            <p class="radio-option-description">
                                No connection message. The AI agent will start immediately.
                            </p>
                        </div>
                    </div>

                </div>

                <!-- Intelligent Fallback System -->
                ${this.renderFallbackSection(voice.fallback)}
            </div>
        `;
    }

    /**
     * Render pre-recorded audio section
     */
    renderPrerecordedSection(prerecorded) {
        const hasActiveFile = prerecorded?.activeFileUrl;

        if (hasActiveFile) {
            return `
                <div class="voice-upload-section">
                    <h5 style="margin: 0 0 8px 0; font-size: 13px; font-weight: 700;">🎵 Current Audio File</h5>
                    
                    <div class="audio-preview-card">
                        <div class="audio-icon">🎵</div>
                        <div class="audio-details">
                            <h4>${prerecorded.activeFileName || 'greeting.mp3'}</h4>
                            <div class="audio-meta">
                                <span>Duration: ${prerecorded.activeDuration || 'Unknown'}s</span>
                                <span>Size: ${this.formatFileSize(prerecorded.activeFileSize)}</span>
                                <span>Uploaded: ${this.formatDate(prerecorded.uploadedAt)}</span>
                            </div>
                        </div>
                        <div class="audio-actions">
                            <button class="btn-audio-preview" onclick="connectionMessagesManager.previewAudio('${prerecorded.activeFileUrl}')">
                                ▶️ Preview
                            </button>
                            <button class="btn-audio-download" onclick="connectionMessagesManager.downloadAudio('${prerecorded.activeFileUrl}', '${prerecorded.activeFileName}')">
                                ⬇️ Download
                            </button>
                            <button class="btn-audio-replace" onclick="document.getElementById('audio-upload-input').click()">
                                🔄 Replace
                            </button>
                            <button class="btn-audio-remove" onclick="connectionMessagesManager.removeAudio()">
                                🗑️ Remove
                            </button>
                        </div>
                    </div>
                </div>

                <div class="voice-upload-section">
                    <h5 style="margin: 0 0 8px 0; font-size: 13px; font-weight: 700;">📤 Upload New Audio</h5>
                    <div class="file-upload-wrapper">
                        <input type="file" id="audio-upload-input" class="file-upload-input" accept=".mp3,.wav,.m4a" onchange="connectionMessagesManager.handleFileUpload(event)">
                        <button class="file-upload-btn" onclick="document.getElementById('audio-upload-input').click()">
                            <i class="fas fa-upload"></i>
                            Choose File (.mp3, .wav, .m4a - max 5MB)
                        </button>
                    </div>
                </div>

                ${this.renderElevenLabsGenerator()}
            `;
        } else {
            return `
                <div class="voice-upload-section">
                    <h5 style="margin: 0 0 8px 0; font-size: 13px; font-weight: 700;">📤 Upload Audio File</h5>
                    <p style="font-size: 12px; color: #6c757d; margin-bottom: 8px;">
                        Upload a pre-recorded greeting (MP3, WAV, or M4A format, max 5MB)
                    </p>
                    <div class="file-upload-wrapper">
                        <input type="file" id="audio-upload-input" class="file-upload-input" accept=".mp3,.wav,.m4a" onchange="connectionMessagesManager.handleFileUpload(event)">
                        <button class="file-upload-btn" onclick="document.getElementById('audio-upload-input').click()">
                            <i class="fas fa-upload"></i>
                            Choose File (.mp3, .wav, .m4a - max 5MB)
                        </button>
                    </div>
                </div>

                ${this.renderElevenLabsGenerator()}
            `;
        }
    }

    /**
     * Render ElevenLabs generator section
     */
    renderElevenLabsGenerator() {
        return `
            <div class="elevenlabs-generator">
                <h5 style="margin: 0 0 4px 0; font-size: 13px; font-weight: 700;">
                    <i class="fas fa-magic" style="color: #6366f1;"></i>
                    Generate with ElevenLabs
                </h5>
                <p style="font-size: 12px; color: #6c757d; margin: 0 0 8px 0;">
                    Generate audio from text, then download and upload it as a pre-recorded file
                </p>

                <label style="font-size: 12px; font-weight: 600; color: #495057; display: block; margin-bottom: 4px;">
                    Greeting Text:
                </label>
                <textarea id="elevenlabs-text" placeholder="Thank you for calling {companyname}. Please wait a moment while we connect you..." style="font-family: inherit; min-height: 80px;">Thank you for calling. Please wait a moment while we connect you...</textarea>

                ${this.renderVoiceInfo()}

                <button class="btn-generate" onclick="connectionMessagesManager.generateWithElevenLabs()">
                    <i class="fas fa-wand-magic-sparkles"></i>
                    Generate & Download Audio
                </button>

                <p style="font-size: 11px; color: #6c757d; margin: 8px 0 0 0;">
                    💡 <strong>Tip:</strong> After generating, the audio will download to your computer. Then upload it using the button above.
                </p>
            </div>
        `;
    }

    /**
     * Render voice info (from AI Voice Settings)
     */
    renderVoiceInfo() {
        if (!this.voiceSettings || !this.voiceSettings.selectedVoice) {
            return `
                <div style="padding: 10px; background: #fff3cd; border-radius: 6px; margin: 8px 0;">
                    <strong style="font-size: 12px;">⚠️ Voice Not Configured</strong>
                    <p style="margin: 4px 0 0 0; font-size: 11px;">
                        Please configure your ElevenLabs voice in the <strong>AI Voice Settings</strong> tab first.
                    </p>
                </div>
            `;
        }

        return `
            <div style="padding: 8px 10px; background: #e7f5ff; border: 2px solid #339af0; border-radius: 6px; margin: 8px 0;">
                <div style="display: flex; align-items: center; gap: 6px; font-size: 12px;">
                    <i class="fas fa-microphone" style="color: #339af0;"></i>
                    <strong style="color: #1971c2;">Voice:</strong>
                    <span style="color: #495057;">${this.voiceSettings.selectedVoice}</span>
                </div>
            </div>
        `;
    }

    /**
     * Render real-time TTS section
     */
    renderRealtimeSection(realtime) {
        return `
            <div class="voice-upload-section">
                <label style="font-size: 12px; font-weight: 600; color: #495057; display: block; margin-bottom: 4px;">
                    Greeting Text:
                </label>
                <textarea id="realtime-text" style="width: 100%; padding: 12px; border: 2px solid #e9ecef; border-radius: 8px; font-size: 14px; min-height: 100px; resize: vertical;" placeholder="Thank you for calling {companyname}. Please wait a moment...">${realtime?.text || 'Thank you for calling. Please wait a moment while we connect you...'}</textarea>

                <p style="font-size: 11px; color: #6c757d; margin: 6px 0;">
                    Available variables: <code>{companyname}</code>
                </p>

                <div style="padding: 10px; background: #fff3cd; border-radius: 6px; margin-top: 10px;">
                    <strong style="font-size: 12px;">⚠️ Cost Warning:</strong> 
                    <span style="font-size: 11px;">This will generate audio for every call using ElevenLabs API. Estimated cost: ~$0.03 per call.</span>
                </div>
            </div>
        `;
    }

    /**
     * Render intelligent fallback system
     */
    renderFallbackSection(fallback) {
        const fallbackConfig = fallback || {};
        const enabled = fallbackConfig.enabled !== false; // Default: enabled
        const smsEnabled = fallbackConfig.smsEnabled !== false; // Default: enabled
        const notifyAdmin = fallbackConfig.notifyAdmin !== false; // Default: enabled
        const adminMethod = fallbackConfig.adminNotificationMethod || 'sms';

        return `
            <div style="margin-top: 32px; padding: 24px; background: linear-gradient(135deg, #fff3cd 0%, #ffeaa7 100%); border: 2px solid #ffc107; border-radius: 12px;">
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
                    <span style="font-size: 32px;">🛡️</span>
                    <div>
                        <h4 style="margin: 0; font-size: 16px; font-weight: 700; color: #856404;">
                            Intelligent Fallback System
                        </h4>
                        <p style="margin: 4px 0 0 0; font-size: 13px; color: #856404;">
                            Emergency backup when primary greeting fails
                        </p>
                    </div>
                </div>

                <div style="margin-bottom: 16px;">
                    <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
                        <input type="checkbox" id="fallback-enabled" ${enabled ? 'checked' : ''} style="width: 20px; height: 20px;">
                        <span style="font-weight: 600; font-size: 14px; color: #495057;">Enable Intelligent Fallback</span>
                    </label>
                </div>

                <div id="fallback-config" style="${enabled ? '' : 'opacity: 0.5; pointer-events: none;'}">
                    
                    <!-- Voice Fallback Message -->
                    <div style="background: white; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                        <h5 style="margin: 0 0 8px 0; font-size: 14px; font-weight: 700; color: #495057;">
                            <i class="fas fa-microphone" style="color: #339af0;"></i>
                            Voice Fallback (ElevenLabs TTS)
                        </h5>
                        <p style="margin: 0 0 10px 0; font-size: 12px; color: #6c757d;">
                            What the AI should say if the primary greeting fails:
                        </p>
                        <textarea id="fallback-voice-message" 
                            style="width: 100%; padding: 12px; border: 2px solid #e9ecef; border-radius: 8px; font-size: 13px; min-height: 90px; resize: vertical; font-family: inherit;"
                            placeholder="We're experiencing technical difficulties. Please hold while we connect you to our team...">${fallbackConfig.voiceMessage || "We're experiencing technical difficulties. Please hold while we connect you to our team."}</textarea>
                        <p style="margin: 6px 0 0 0; font-size: 11px; color: #6c757d;">
                            Available variables: <code>{companyname}</code>
                        </p>
                    </div>

                    <!-- SMS Customer Notification -->
                    <div style="background: white; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                        <div style="margin-bottom: 10px;">
                            <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
                                <input type="checkbox" id="fallback-sms-enabled" ${smsEnabled ? 'checked' : ''} style="width: 18px; height: 18px;">
                                <span style="font-weight: 700; font-size: 14px; color: #495057;">
                                    <i class="fas fa-sms" style="color: #28a745;"></i>
                                    Text Customer via SMS
                                </span>
                            </label>
                        </div>
                        <div id="fallback-sms-config" style="${smsEnabled ? '' : 'opacity: 0.5; pointer-events: none;'}">
                            <p style="margin: 0 0 10px 0; font-size: 12px; color: #6c757d;">
                                Send an apology text to the customer when fallback is triggered:
                            </p>
                            <textarea id="fallback-sms-message" 
                                style="width: 100%; padding: 12px; border: 2px solid #e9ecef; border-radius: 8px; font-size: 13px; min-height: 80px; resize: vertical; font-family: inherit;"
                                placeholder="Sorry, our voice system missed your call. How can we help you?">${fallbackConfig.smsMessage || "Sorry, our voice system missed your call. How can we help you?"}</textarea>
                            <p style="margin: 6px 0 0 0; font-size: 11px; color: #6c757d;">
                                💡 This helps maintain customer trust when technical issues occur
                            </p>
                        </div>
                    </div>

                    <!-- Admin Notification -->
                    <div style="background: white; padding: 16px; border-radius: 8px;">
                        <div style="margin-bottom: 10px;">
                            <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
                                <input type="checkbox" id="fallback-notify-admin" ${notifyAdmin ? 'checked' : ''} style="width: 18px; height: 18px;">
                                <span style="font-weight: 700; font-size: 14px; color: #495057;">
                                    <i class="fas fa-bell" style="color: #dc3545;"></i>
                                    Alert Admin
                                </span>
                            </label>
                        </div>
                        <div id="fallback-admin-config" style="${notifyAdmin ? '' : 'opacity: 0.5; pointer-events: none;'}">
                            
                            <!-- Admin Contact Information -->
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px;">
                                <div>
                                    <label style="font-size: 12px; font-weight: 600; color: #495057; display: block; margin-bottom: 4px;">
                                        📱 Admin Phone:
                                    </label>
                                    <input type="tel" id="fallback-admin-phone" 
                                        style="width: 100%; padding: 8px 10px; border: 2px solid #e9ecef; border-radius: 6px; font-size: 13px; font-family: inherit;"
                                        placeholder="+1234567890"
                                        value="${fallbackConfig.adminPhone || ''}">
                                </div>
                                <div>
                                    <label style="font-size: 12px; font-weight: 600; color: #495057; display: block; margin-bottom: 4px;">
                                        📧 Admin Email:
                                    </label>
                                    <input type="email" id="fallback-admin-email" 
                                        style="width: 100%; padding: 8px 10px; border: 2px solid #e9ecef; border-radius: 6px; font-size: 13px; font-family: inherit;"
                                        placeholder="admin@company.com"
                                        value="${fallbackConfig.adminEmail || ''}">
                                </div>
                            </div>

                            <!-- Notification Method -->
                            <p style="margin: 0 0 8px 0; font-size: 12px; font-weight: 600; color: #495057;">
                                Notification Method:
                            </p>
                            <div style="display: flex; gap: 10px; margin-bottom: 12px;">
                                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; padding: 8px 14px; border: 2px solid #e9ecef; border-radius: 6px; flex: 1; background: ${adminMethod === 'sms' ? '#e7f5ff' : 'white'};">
                                    <input type="radio" name="admin-method" value="sms" ${adminMethod === 'sms' ? 'checked' : ''}>
                                    <span style="font-size: 12px; font-weight: 600;">📱 SMS</span>
                                </label>
                                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; padding: 8px 14px; border: 2px solid #e9ecef; border-radius: 6px; flex: 1; background: ${adminMethod === 'email' ? '#e7f5ff' : 'white'};">
                                    <input type="radio" name="admin-method" value="email" ${adminMethod === 'email' ? 'checked' : ''}>
                                    <span style="font-size: 12px; font-weight: 600;">📧 Email</span>
                                </label>
                                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; padding: 8px 14px; border: 2px solid #e9ecef; border-radius: 6px; flex: 1; background: ${adminMethod === 'both' ? '#e7f5ff' : 'white'};">
                                    <input type="radio" name="admin-method" value="both" ${adminMethod === 'both' ? 'checked' : ''}>
                                    <span style="font-size: 12px; font-weight: 600;">📱📧 Both</span>
                                </label>
                            </div>

                            <!-- Admin SMS Message (Customizable) -->
                            <label style="font-size: 12px; font-weight: 600; color: #495057; display: block; margin-bottom: 4px;">
                                Admin Alert Message:
                            </label>
                            <textarea id="fallback-admin-sms-message" 
                                style="width: 100%; padding: 10px 12px; border: 2px solid #e9ecef; border-radius: 6px; font-size: 12px; min-height: 70px; resize: vertical; font-family: inherit;"
                                placeholder="⚠️ FALLBACK ALERT: Greeting fallback occurred in {companyname} ({companyid}). Please check settings.">${fallbackConfig.adminSmsMessage || "⚠️ FALLBACK ALERT: Greeting fallback occurred in {companyname} ({companyid}). Please check the Messages & Greetings settings immediately."}</textarea>
                            <p style="margin: 6px 0 0 0; font-size: 11px; color: #6c757d;">
                                💡 Available variables: <code>{companyname}</code>, <code>{companyid}</code>, and all Variables from the Variables tab
                            </p>
                        </div>
                    </div>

                </div>
            </div>
        `;
    }

    /**
     * Render SMS content
     */
    renderSMSContent() {
        const sms = this.config?.sms || {};

        return `
            <div class="telephony-section">
                <h3>💬 SMS Auto-Reply</h3>
                <p style="margin-bottom: 24px;">Send an instant text message when a customer first texts your number:</p>

                <div style="margin-bottom: 16px;">
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                        <input type="checkbox" id="sms-enabled" ${sms.enabled ? 'checked' : ''} style="width: 18px; height: 18px;">
                        <span style="font-weight: 600;">Enable SMS Auto-Reply</span>
                    </label>
                </div>

                <div id="sms-config" style="${sms.enabled ? '' : 'opacity: 0.5; pointer-events: none;'}">
                    <label style="font-size: 14px; font-weight: 600; color: #495057; display: block; margin-bottom: 8px;">
                        Auto-Reply Message:
                    </label>
                    <textarea id="sms-text" style="width: 100%; padding: 12px; border: 2px solid #e9ecef; border-radius: 8px; font-size: 14px; min-height: 100px; resize: vertical;" placeholder="Thanks for texting {companyname}! Our AI assistant will respond shortly...">${sms.text || 'Thanks for contacting us! Our AI assistant will respond shortly.'}</textarea>

                    <p style="font-size: 12px; color: #6c757d; margin: 12px 0;">
                        Available variables: <code>{companyname}</code>, <code>{businesshours}</code>
                    </p>

                    <div style="margin-top: 20px; padding: 16px; background: #f8f9fa; border-radius: 8px;">
                        <h5 style="margin: 0 0 12px 0; font-size: 14px; font-weight: 700;">
                            📅 Business Hours Variants (Optional)
                        </h5>
                        
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; margin-bottom: 12px;">
                            <input type="checkbox" id="sms-business-hours-enabled" ${sms.businessHours?.enabled ? 'checked' : ''} style="width: 18px; height: 18px;">
                            <span>Send different messages during vs. after business hours</span>
                        </label>

                        <div id="sms-business-hours-config" style="${sms.businessHours?.enabled ? '' : 'opacity: 0.5; pointer-events: none;'}">
                            <label style="font-size: 13px; font-weight: 600; color: #495057; display: block; margin-bottom: 6px;">
                                During Business Hours:
                            </label>
                            <textarea id="sms-during-hours" style="width: 100%; padding: 10px; border: 2px solid #e9ecef; border-radius: 6px; font-size: 13px; min-height: 70px; resize: vertical; margin-bottom: 12px;" placeholder="Thanks for texting! We'll respond right away...">${sms.businessHours?.duringHours || ''}</textarea>

                            <label style="font-size: 13px; font-weight: 600; color: #495057; display: block; margin-bottom: 6px;">
                                After Business Hours:
                            </label>
                            <textarea id="sms-after-hours" style="width: 100%; padding: 10px; border: 2px solid #e9ecef; border-radius: 6px; font-size: 13px; min-height: 70px; resize: vertical;" placeholder="Thanks for texting! We're currently closed but will respond first thing...">${sms.businessHours?.afterHours || ''}</textarea>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Render web chat content (placeholder)
     */
    renderWebChatContent() {
        return `
            <div class="telephony-empty-state">
                <i class="fas fa-comments"></i>
                <h4>Web Chat Coming Soon</h4>
                <p>Configure instant auto-replies for web chat visitors when this feature launches</p>
            </div>
        `;
    }

    /**
     * Render save buttons
     */
    renderSaveButtons() {
        return `
            <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px;">
                <button class="btn-secondary" onclick="connectionMessagesManager.resetToDefaults()">
                    🔄 Reset to Defaults
                </button>
                <button class="btn-primary" onclick="connectionMessagesManager.save()">
                    💾 Save Connection Messages
                </button>
            </div>
        `;
    }

    /**
     * Attach event listeners
     */
    attachEventListeners() {
        // Channel selector
        document.querySelectorAll('.channel-option').forEach(option => {
            option.addEventListener('click', (e) => {
                const channel = option.dataset.channel;
                if (channel === 'webchat') return; // Disabled for now

                this.currentChannel = channel;
                this.render();
            });
        });

        // Voice mode radio buttons
        document.querySelectorAll('input[name="voice-mode"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                document.querySelectorAll('.radio-option-card').forEach(card => {
                    card.classList.remove('selected');
                });
                e.target.closest('.radio-option-card').classList.add('selected');
            });
        });

        // SMS enabled checkbox
        const smsEnabled = document.getElementById('sms-enabled');
        if (smsEnabled) {
            smsEnabled.addEventListener('change', (e) => {
                const config = document.getElementById('sms-config');
                if (e.target.checked) {
                    config.style.opacity = '1';
                    config.style.pointerEvents = 'auto';
                } else {
                    config.style.opacity = '0.5';
                    config.style.pointerEvents = 'none';
                }
            });
        }

        // SMS business hours checkbox
        const smsBusinessHoursEnabled = document.getElementById('sms-business-hours-enabled');
        if (smsBusinessHoursEnabled) {
            smsBusinessHoursEnabled.addEventListener('change', (e) => {
                const config = document.getElementById('sms-business-hours-config');
                if (e.target.checked) {
                    config.style.opacity = '1';
                    config.style.pointerEvents = 'auto';
                } else {
                    config.style.opacity = '0.5';
                    config.style.pointerEvents = 'none';
                }
            });
        }

        // Fallback enabled checkbox
        const fallbackEnabled = document.getElementById('fallback-enabled');
        if (fallbackEnabled) {
            fallbackEnabled.addEventListener('change', (e) => {
                const config = document.getElementById('fallback-config');
                if (e.target.checked) {
                    config.style.opacity = '1';
                    config.style.pointerEvents = 'auto';
                } else {
                    config.style.opacity = '0.5';
                    config.style.pointerEvents = 'none';
                }
            });
        }

        // Fallback SMS enabled checkbox
        const fallbackSmsEnabled = document.getElementById('fallback-sms-enabled');
        if (fallbackSmsEnabled) {
            fallbackSmsEnabled.addEventListener('change', (e) => {
                const config = document.getElementById('fallback-sms-config');
                if (e.target.checked) {
                    config.style.opacity = '1';
                    config.style.pointerEvents = 'auto';
                } else {
                    config.style.opacity = '0.5';
                    config.style.pointerEvents = 'none';
                }
            });
        }

        // Fallback admin notification checkbox
        const fallbackNotifyAdmin = document.getElementById('fallback-notify-admin');
        if (fallbackNotifyAdmin) {
            fallbackNotifyAdmin.addEventListener('change', (e) => {
                const config = document.getElementById('fallback-admin-config');
                if (e.target.checked) {
                    config.style.opacity = '1';
                    config.style.pointerEvents = 'auto';
                } else {
                    config.style.opacity = '0.5';
                    config.style.pointerEvents = 'none';
                }
            });
        }
    }

    /**
     * Handle file upload
     */
    async handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        // Validate file
        const maxSize = 5 * 1024 * 1024; // 5MB
        if (file.size > maxSize) {
            alert('⚠️ File too large! Maximum size is 5MB.');
            return;
        }

        const validTypes = ['audio/mpeg', 'audio/wav', 'audio/x-m4a', 'audio/mp4'];
        if (!validTypes.includes(file.type) && !file.name.match(/\.(mp3|wav|m4a)$/i)) {
            alert('⚠️ Invalid file type! Please upload .mp3, .wav, or .m4a files only.');
            return;
        }

        console.log('📤 [CONNECTION MESSAGES] Uploading file:', file.name);

        try {
            const formData = new FormData();
            formData.append('audio', file);

            const response = await fetch(`/api/company/${this.companyId}/connection-messages/voice/upload`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                },
                body: formData
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const result = await response.json();

            console.log('✅ [CONNECTION MESSAGES] Upload successful:', result);
            alert('✅ Audio file uploaded successfully!');

            // Reload config and re-render
            await this.loadConfig();
            this.render();

        } catch (error) {
            console.error('❌ [CONNECTION MESSAGES] Upload failed:', error);
            alert(`Failed to upload audio file: ${error.message}`);
        }
    }

    /**
     * Preview audio
     */
    previewAudio(url) {
        const audio = new Audio(url);
        audio.play();
        console.log('▶️ [CONNECTION MESSAGES] Playing audio preview');
    }

    /**
     * Download audio
     */
    downloadAudio(url, filename) {
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        console.log('⬇️ [CONNECTION MESSAGES] Downloading audio');
    }

    /**
     * Remove audio
     */
    async removeAudio() {
        if (!confirm('Are you sure you want to remove the current audio file?')) {
            return;
        }

        try {
            const response = await fetch(`/api/company/${this.companyId}/connection-messages/voice/remove`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                }
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            alert('✅ Audio file removed successfully!');

            // Reload config and re-render
            await this.loadConfig();
            this.render();

        } catch (error) {
            console.error('❌ [CONNECTION MESSAGES] Remove failed:', error);
            alert(`Failed to remove audio file: ${error.message}`);
        }
    }

    /**
     * Generate with ElevenLabs
     */
    async generateWithElevenLabs() {
        const text = document.getElementById('elevenlabs-text')?.value;

        if (!text) {
            alert('⚠️ Please enter greeting text');
            return;
        }

        // Get voice ID from AI Voice Settings
        if (!this.voiceSettings || !this.voiceSettings.selectedVoiceId) {
            alert('⚠️ Please configure your ElevenLabs voice in the AI Voice Settings tab first.');
            return;
        }

        const voiceId = this.voiceSettings.selectedVoiceId;

        console.log('🎵 [CONNECTION MESSAGES] Generating with ElevenLabs...');
        console.log('🎵 Text:', text.substring(0, 50) + (text.length > 50 ? '...' : ''));
        console.log('🎵 Voice ID from AI Voice Settings:', voiceId);

        try {
            const response = await fetch(`/api/company/${this.companyId}/connection-messages/voice/generate`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ text, voiceId })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.details || errorData.message || `HTTP ${response.status}`);
            }

            // Download the generated audio
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `greeting_${Date.now()}.mp3`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);

            alert('✅ Audio generated successfully! File downloaded.\n\nNow upload it using the "Upload Audio File" button above.');

            console.log('✅ [CONNECTION MESSAGES] Generated and downloaded');

        } catch (error) {
            console.error('❌ [CONNECTION MESSAGES] Generation failed:', error);
            alert(`Failed to generate audio: ${error.message}`);
        }
    }

    /**
     * Save configuration
     */
    async save() {
        console.log('💾 [CONNECTION MESSAGES] Saving...');

        try {
            // Collect data based on current channel
            const data = {};

            if (this.currentChannel === 'voice') {
                const mode = document.querySelector('input[name="voice-mode"]:checked')?.value;
                const realtimeText = document.getElementById('realtime-text')?.value;

                // Collect intelligent fallback settings
                const fallbackEnabled = document.getElementById('fallback-enabled')?.checked;
                const fallbackVoiceMessage = document.getElementById('fallback-voice-message')?.value;
                const fallbackSmsEnabled = document.getElementById('fallback-sms-enabled')?.checked;
                const fallbackSmsMessage = document.getElementById('fallback-sms-message')?.value;
                const fallbackNotifyAdmin = document.getElementById('fallback-notify-admin')?.checked;
                const fallbackAdminMethod = document.querySelector('input[name="admin-method"]:checked')?.value;
                const fallbackAdminPhone = document.getElementById('fallback-admin-phone')?.value;
                const fallbackAdminEmail = document.getElementById('fallback-admin-email')?.value;
                const fallbackAdminSmsMessage = document.getElementById('fallback-admin-sms-message')?.value;

                data.voice = {
                    mode,
                    text: realtimeText,  // CRITICAL: Send as voice.text (primary field)
                    realtime: { text: realtimeText },  // Keep for backwards compatibility
                    fallback: {
                        enabled: fallbackEnabled,
                        voiceMessage: fallbackVoiceMessage,
                        smsEnabled: fallbackSmsEnabled,
                        smsMessage: fallbackSmsMessage,
                        notifyAdmin: fallbackNotifyAdmin,
                        adminNotificationMethod: fallbackAdminMethod,
                        adminPhone: fallbackAdminPhone,
                        adminEmail: fallbackAdminEmail,
                        adminSmsMessage: fallbackAdminSmsMessage
                    }
                };
            } else if (this.currentChannel === 'sms') {
                const enabled = document.getElementById('sms-enabled')?.checked;
                const text = document.getElementById('sms-text')?.value;
                const businessHoursEnabled = document.getElementById('sms-business-hours-enabled')?.checked;
                const duringHours = document.getElementById('sms-during-hours')?.value;
                const afterHours = document.getElementById('sms-after-hours')?.value;

                data.sms = {
                    enabled,
                    text,
                    businessHours: {
                        enabled: businessHoursEnabled,
                        duringHours,
                        afterHours
                    }
                };
            } else if (this.currentChannel === 'webchat') {
                const enabled = document.getElementById('webchat-enabled')?.checked;
                const text = document.getElementById('webchat-text')?.value;

                data.webChat = {
                    enabled,
                    text
                };
            }

            console.log('📤 [CONNECTION MESSAGES] Sending data:', JSON.stringify(data, null, 2));

            const response = await fetch(`/api/company/${this.companyId}/connection-messages/config`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            });

            console.log('📥 [CONNECTION MESSAGES] Response status:', response.status);
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                console.error('❌ [CONNECTION MESSAGES] Error response:', errorData);
                throw new Error(`HTTP ${response.status}: ${errorData.details || errorData.error || 'Unknown error'}`);
            }

            console.log('✅ [CONNECTION MESSAGES] Saved successfully');

            // Reload config
            await this.loadConfig();
            
            // Re-render UI to show updated mode
            this.render();
            
            alert('✅ Connection messages saved successfully!');

        } catch (error) {
            console.error('❌ [CONNECTION MESSAGES] Save failed:', error);
            alert(`Failed to save: ${error.message}`);
        }
    }

    /**
     * Reset to defaults
     */
    async resetToDefaults() {
        if (!confirm('Are you sure you want to reset to default settings?')) {
            return;
        }

        try {
            const response = await fetch(`/api/company/${this.companyId}/connection-messages/reset`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                }
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            alert('✅ Reset to defaults successfully!');

            // Reload config and re-render
            await this.loadConfig();
            this.render();

        } catch (error) {
            console.error('❌ [CONNECTION MESSAGES] Reset failed:', error);
            alert(`Failed to reset: ${error.message}`);
        }
    }

    /**
     * Render error state
     */
    renderError(message) {
        const container = document.getElementById('connection-messages-container');
        if (!container) return;

        container.innerHTML = `
            <div class="telephony-empty-state">
                <i class="fas fa-exclamation-triangle"></i>
                <h4>Error Loading Connection Messages</h4>
                <p>${message}</p>
                <button class="btn-primary" onclick="connectionMessagesManager.initialize()">
                    Retry
                </button>
            </div>
        `;
    }

    /**
     * Format file size
     */
    formatFileSize(bytes) {
        if (!bytes) return '0 KB';
        const kb = bytes / 1024;
        if (kb < 1024) return `${kb.toFixed(1)} KB`;
        return `${(kb / 1024).toFixed(1)} MB`;
    }

    /**
     * Format date
     */
    formatDate(date) {
        if (!date) return 'Unknown';
        const d = new Date(date);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
}

// Note: Global instance is declared in company-profile.html initialization script

