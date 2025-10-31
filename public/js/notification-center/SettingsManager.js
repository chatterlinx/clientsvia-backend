// ============================================================================
// ⚙️ SETTINGS MANAGER - Notification Center Settings Tab
// ============================================================================
// Purpose: Manage Twilio credentials and admin contacts
// ============================================================================

class SettingsManager {
    constructor(notificationCenter) {
        this.nc = notificationCenter;
        this.adminContacts = [];
    }
    
    async load() {
        console.log('⚙️ [SETTINGS] Loading settings...');
        
        await Promise.all([
            this.loadTwilioCredentials(),
            this.loadTestCallConfig(),
            this.loadAdminContacts(),
            this.loadEscalationSettings(),
            this.loadNotificationPolicy(),
            this.loadAlertThresholds()
        ]);
        
        this.attachEventHandlers();
        
        // CRITICAL: Auto-run ER Triage Monitor on page load (no button press)
        // This populates Redis status banner and critical failure card immediately
        await this.testThresholdConnection();
    }
    
    // ========================================================================
    // TWILIO CREDENTIALS
    // ========================================================================
    
    async loadTwilioCredentials() {
        try {
            const response = await this.nc.apiGet('/api/admin/notifications/settings');
            
            if (response.success && response.data && response.data.twilio) {
                document.getElementById('twilio-account-sid').value = response.data.twilio.accountSid || '';
                document.getElementById('twilio-auth-token').value = response.data.twilio.authToken || '';
                document.getElementById('twilio-phone-number').value = response.data.twilio.phoneNumber || '';
            } else {
                console.log('ℹ️ [SETTINGS] No Twilio credentials configured yet');
            }
            
        } catch (error) {
            console.error('❌ [SETTINGS] Failed to load Twilio credentials:', error);
        }
    }
    
    async saveTwilioCredentials() {
        try {
            const accountSid = document.getElementById('twilio-account-sid').value.trim();
            const authToken = document.getElementById('twilio-auth-token').value.trim();
            const phoneNumber = document.getElementById('twilio-phone-number').value.trim();
            
            if (!accountSid || !authToken || !phoneNumber) {
                this.nc.showToast('Please fill all Twilio fields', 'error');
                return;
            }
            
            const data = await this.nc.apiPut('/api/admin/notifications/settings', {
                twilio: {
                    accountSid,
                    authToken,
                    phoneNumber
                }
            });
            
            if (data.success) {
                this.nc.showToast('Twilio credentials saved successfully', 'success');
            } else {
                this.nc.showToast('Failed to save Twilio credentials', 'error');
            }
            
        } catch (error) {
            console.error('❌ [SETTINGS] Failed to save Twilio credentials:', error);
            this.nc.showToast(`Error: ${error.message}`, 'error');
        }
    }
    
    // ========================================================================
    // TEST CALL CONFIGURATION
    // ========================================================================
    
    async loadTestCallConfig() {
        try {
            const response = await this.nc.apiGet('/api/admin/notifications/settings');
            
            if (response.success && response.data && response.data.twilioTest) {
                const config = response.data.twilioTest;
                
                document.getElementById('test-call-enabled').checked = config.enabled || false;
                document.getElementById('test-call-phone').value = config.phoneNumber || '+18885222241';
                document.getElementById('test-call-greeting').value = config.greeting || 
                    'This is a ClientsVia system check. Your Twilio integration is working correctly. If you can hear this message, voice webhooks are properly configured. Thank you for calling.';
            } else {
                // Set defaults
                document.getElementById('test-call-enabled').checked = false;
                document.getElementById('test-call-phone').value = '+18885222241';
                document.getElementById('test-call-greeting').value = 
                    'This is a ClientsVia system check. Your Twilio integration is working correctly. If you can hear this message, voice webhooks are properly configured. Thank you for calling.';
            }
            
        } catch (error) {
            console.error('❌ [SETTINGS] Failed to load test call config:', error);
        }
    }
    
    async saveTestCallConfig() {
        try {
            const enabled = document.getElementById('test-call-enabled').checked;
            const phoneNumber = document.getElementById('test-call-phone').value.trim();
            const greeting = document.getElementById('test-call-greeting').value.trim();
            
            if (!phoneNumber) {
                this.nc.showToast('Please enter a phone number', 'error');
                return;
            }
            
            if (!greeting) {
                this.nc.showToast('Please enter a greeting message', 'error');
                return;
            }
            
            const data = await this.nc.apiPut('/api/admin/notifications/settings', {
                twilioTest: {
                    enabled: enabled,
                    phoneNumber: phoneNumber,
                    greeting: greeting
                }
            });
            
            if (data.success) {
                this.nc.showToast('Test call settings saved successfully!', 'success');
            } else {
                this.nc.showToast('Failed to save test call settings', 'error');
            }
            
        } catch (error) {
            console.error('❌ [SETTINGS] Failed to save test call config:', error);
            this.nc.showToast(`Error: ${error.message}`, 'error');
        }
    }
    
    // ========================================================================
    // ADMIN CONTACTS
    // ========================================================================
    
    async loadAdminContacts() {
        try {
            const response = await this.nc.apiGet('/api/admin/notifications/settings');
            
            if (response.success && response.data) {
                this.adminContacts = response.data.adminContacts || [];
                this.renderAdminContacts();
            } else {
                console.log('ℹ️ [SETTINGS] No admin contacts configured yet');
                this.adminContacts = [];
                this.renderAdminContacts();
            }
            
        } catch (error) {
            console.error('❌ [SETTINGS] Failed to load admin contacts:', error);
            document.getElementById('admin-contacts-list').innerHTML = '<p class="text-red-600">Error loading contacts</p>';
        }
    }
    
    renderAdminContacts() {
        const container = document.getElementById('admin-contacts-list');
        
        if (this.adminContacts.length === 0) {
            container.innerHTML = '<p class="text-gray-500 italic">No admin contacts configured yet. Add one above.</p>';
            return;
        }
        
        container.innerHTML = this.adminContacts.map((contact, index) => {
            // Escape HTML to prevent XSS
            const escapeName = this.escapeHtml(contact.name);
            const escapePhone = this.escapeHtml(contact.phone);
            const escapeEmail = contact.email ? this.escapeHtml(contact.email) : '';
            
            return `
                <div class="border border-gray-300 rounded-lg p-4 bg-white hover:shadow-md transition">
                    <div class="flex justify-between items-start">
                        <div class="flex-1">
                            <p class="font-semibold text-gray-800 text-lg">${escapeName}</p>
                            <p class="text-sm text-gray-600 mt-2">
                                <i class="fas fa-phone text-green-600 mr-2"></i>
                                ${escapePhone}
                            </p>
                            ${contact.email ? `
                                <p class="text-sm text-gray-600 mt-1">
                                    <i class="fas fa-envelope text-blue-600 mr-2"></i>
                                    ${escapeEmail}
                                </p>
                            ` : ''}
                            <div class="mt-3 flex gap-2 flex-wrap">
                                ${contact.receiveSMS ? '<span class="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">📱 SMS</span>' : ''}
                                ${contact.receiveEmail ? '<span class="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">📧 Email</span>' : ''}
                                ${contact.receiveCalls ? '<span class="text-xs bg-purple-100 text-purple-800 px-2 py-1 rounded">📞 Calls</span>' : ''}
                            </div>
                            ${contact.receiveSMS ? `
                                <button 
                                    class="mt-3 text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded transition"
                                    onclick="window.settingsManager.sendTestSMS(${index})"
                                    title="Send test SMS to verify delivery"
                                >
                                    <i class="fas fa-paper-plane mr-1"></i>
                                    Send Test SMS
                                </button>
                            ` : ''}
                        </div>
                        <button 
                            class="text-red-600 hover:text-red-800 hover:bg-red-50 p-2 rounded transition" 
                            onclick="window.settingsManager.removeAdminContact(${index})"
                            title="Remove contact"
                        >
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }
    
    async addAdminContact() {
        try {
            // Get form values
            const name = document.getElementById('new-contact-name').value.trim();
            const phone = document.getElementById('new-contact-phone').value.trim();
            const email = document.getElementById('new-contact-email').value.trim();
            const receiveSMS = document.getElementById('new-contact-sms').checked;
            const receiveEmail = document.getElementById('new-contact-email-notify').checked;
            const receiveCalls = document.getElementById('new-contact-calls').checked;
            
            // Validation
            if (!name) {
                this.nc.showToast('Please enter a name', 'error');
                return;
            }
            
            if (!phone) {
                this.nc.showToast('Please enter a phone number', 'error');
                return;
            }
            
            // Basic E.164 validation
            if (!phone.startsWith('+')) {
                this.nc.showToast('Phone number must start with + (E.164 format)', 'error');
                return;
            }
            
            // Create new contact
            const newContact = {
                name,
                phone,
                email: email || '',
                receiveSMS,
                receiveEmail: email ? receiveEmail : false,
                receiveCalls
            };
            
            // Add to array
            this.adminContacts.push(newContact);
            
            // Save to backend
            const data = await this.nc.apiPut('/api/admin/notifications/settings', {
                adminContacts: this.adminContacts
            });
            
            if (data.success) {
                this.nc.showToast(`✅ Contact "${name}" added successfully`, 'success');
                
                // Clear form
                document.getElementById('new-contact-name').value = '';
                document.getElementById('new-contact-phone').value = '';
                document.getElementById('new-contact-email').value = '';
                document.getElementById('new-contact-sms').checked = true;
                document.getElementById('new-contact-email-notify').checked = false;
                document.getElementById('new-contact-calls').checked = true;
                
                // Re-render list
                this.renderAdminContacts();
            } else {
                this.nc.showToast('Failed to add contact', 'error');
                this.adminContacts.pop(); // Remove from array if save failed
            }
            
        } catch (error) {
            console.error('❌ [SETTINGS] Failed to add admin contact:', error);
            this.nc.showToast(`Error: ${error.message}`, 'error');
            this.adminContacts.pop(); // Remove from array if save failed
        }
    }
    
    async removeAdminContact(index) {
        const contact = this.adminContacts[index];
        
        if (!confirm(`Are you sure you want to remove "${contact.name}"?`)) {
            return;
        }
        
        try {
            // Remove from array
            this.adminContacts.splice(index, 1);
            
            // Save to backend
            const data = await this.nc.apiPut('/api/admin/notifications/settings', {
                adminContacts: this.adminContacts
            });
            
            if (data.success) {
                this.nc.showToast(`Contact "${contact.name}" removed`, 'success');
                this.renderAdminContacts();
            } else {
                this.nc.showToast('Failed to remove contact', 'error');
                // Re-add if save failed
                this.adminContacts.splice(index, 0, contact);
            }
            
        } catch (error) {
            console.error('❌ [SETTINGS] Failed to remove admin contact:', error);
            this.nc.showToast(`Error: ${error.message}`, 'error');
            // Re-add if save failed
            this.adminContacts.splice(index, 0, contact);
            this.renderAdminContacts();
        }
    }
    
    async sendTestSMS(index) {
        const contact = this.adminContacts[index];
        
        if (!confirm(`Send test SMS to ${contact.name} (${contact.phone})?`)) {
            return;
        }
        
        try {
            this.nc.showToast('Sending test SMS...', 'info');
            
            const data = await this.nc.apiPost('/api/admin/notifications/test-sms', {
                contactIndex: index,
                recipientName: contact.name,
                recipientPhone: contact.phone
            });
            
            if (data.success) {
                console.log('✅ [TEST SMS] Success response:', data);
                console.log(`   Twilio SID: ${data.twilioSid}`);
                console.log(`   Status: ${data.status}`);
                console.log(`   From: ${data.debug?.from}`);
                console.log(`   To: ${data.debug?.to}`);
                
                this.nc.showToast(
                    `✅ Test SMS sent to ${contact.name}!\n\nTwilio SID: ${data.twilioSid}\nStatus: ${data.status}\n\nCheck your phone in 10-30 seconds.`, 
                    'success'
                );
            } else {
                this.nc.showToast(`Failed to send test SMS: ${data.error || 'Unknown error'}`, 'error');
            }
            
        } catch (error) {
            console.error('❌ [SETTINGS] Failed to send test SMS:', error);
            this.nc.showToast(`Error: ${error.message}`, 'error');
        }
    }
    
    async testFullSystem() {
        if (!confirm('🧪 This will send a test alert to ALL configured admin contacts via BOTH SMS and Email.\n\nProceed?')) {
            return;
        }
        
        try {
            this.nc.showToast('📤 Sending test notifications...', 'info');
            
            console.log('🧪 [TEST FULL SYSTEM] Triggering full notification test...');
            
            const data = await this.nc.apiPost('/api/admin/notifications/test-all', {});
            
            if (data.success) {
                console.log('✅ [TEST FULL SYSTEM] Success!', data);
                
                this.nc.showSuccess(
                    `✅ Test notifications sent!\n\n` +
                    `📱 Check your phone for SMS\n` +
                    `📧 Check your email inbox\n` +
                    `📋 Check Alert Log tab for the test entry\n\n` +
                    `${data.message || ''}`
                );
            } else {
                this.nc.showError(`Failed to send test: ${data.error || 'Unknown error'}`);
            }
            
        } catch (error) {
            console.error('❌ [TEST FULL SYSTEM] Failed:', error);
            this.nc.showError(`Test failed: ${error.message}`);
        }
    }
    
    // ========================================================================
    // ESCALATION SETTINGS
    // ========================================================================
    
    async loadEscalationSettings() {
        try {
            const response = await this.nc.apiGet('/api/admin/notifications/settings');
            
            if (response.success && response.data && response.data.escalation) {
                const esc = response.data.escalation;
                document.getElementById('critical-intervals').value = (esc.CRITICAL || [30, 30, 30, 15, 15]).join(', ');
                document.getElementById('warning-intervals').value = (esc.WARNING || [60, 60, 60]).join(', ');
                document.getElementById('info-intervals').value = (esc.INFO || [120]).join(', ');
            } else {
                // Set defaults
                document.getElementById('critical-intervals').value = '30, 30, 30, 15, 15';
                document.getElementById('warning-intervals').value = '60, 60, 60';
                document.getElementById('info-intervals').value = '120';
            }
            
        } catch (error) {
            console.error('❌ [SETTINGS] Failed to load escalation settings:', error);
        }
    }
    
    async saveEscalationSettings() {
        try {
            const criticalStr = document.getElementById('critical-intervals').value.trim();
            const warningStr = document.getElementById('warning-intervals').value.trim();
            const infoStr = document.getElementById('info-intervals').value.trim();
            
            // Parse comma-separated values
            const parseIntervals = (str) => {
                return str.split(',').map(v => parseInt(v.trim(), 10)).filter(n => !isNaN(n) && n > 0);
            };
            
            const critical = parseIntervals(criticalStr);
            const warning = parseIntervals(warningStr);
            const info = parseIntervals(infoStr);
            
            // Validation
            if (critical.length === 0 || warning.length === 0 || info.length === 0) {
                this.nc.showToast('Please enter valid intervals (comma-separated numbers)', 'error');
                return;
            }
            
            const data = await this.nc.apiPut('/api/admin/notifications/settings', {
                escalation: {
                    CRITICAL: critical,
                    WARNING: warning,
                    INFO: info
                }
            });
            
            if (data.success) {
                this.nc.showToast('Escalation settings saved successfully', 'success');
            } else {
                this.nc.showToast('Failed to save escalation settings', 'error');
            }
            
        } catch (error) {
            console.error('❌ [SETTINGS] Failed to save escalation settings:', error);
            this.nc.showToast(`Error: ${error.message}`, 'error');
        }
    }
    
    // ========================================================================
    // NOTIFICATION POLICY (Smart Alert Management)
    // ========================================================================
    
    async loadNotificationPolicy() {
        try {
            const response = await this.nc.apiGet('/api/admin/notifications/settings');
            
            if (response.success && response.data && response.data.notificationPolicy) {
                const policy = response.data.notificationPolicy;
                
                // Severity Rules
                if (policy.severityRules) {
                    // CRITICAL
                    document.getElementById('policy-critical-sms').checked = policy.severityRules.CRITICAL?.sendSMS ?? true;
                    document.getElementById('policy-critical-email').checked = policy.severityRules.CRITICAL?.sendEmail ?? true;
                    document.getElementById('policy-critical-logonly').checked = policy.severityRules.CRITICAL?.logOnly ?? false;
                    
                    // WARNING
                    document.getElementById('policy-warning-sms').checked = policy.severityRules.WARNING?.sendSMS ?? false;
                    document.getElementById('policy-warning-email').checked = policy.severityRules.WARNING?.sendEmail ?? true;
                    document.getElementById('policy-warning-logonly').checked = policy.severityRules.WARNING?.logOnly ?? false;
                    
                    // INFO
                    document.getElementById('policy-info-sms').checked = policy.severityRules.INFO?.sendSMS ?? false;
                    document.getElementById('policy-info-email').checked = policy.severityRules.INFO?.sendEmail ?? false;
                    document.getElementById('policy-info-logonly').checked = policy.severityRules.INFO?.logOnly ?? true;
                }
                
                // Daily Digest
                if (policy.dailyDigest) {
                    document.getElementById('policy-digest-enabled').checked = policy.dailyDigest.enabled ?? true;
                    document.getElementById('policy-digest-time').value = policy.dailyDigest.time || '08:00';
                    document.getElementById('policy-digest-timezone').value = policy.dailyDigest.timezone || 'America/New_York';
                }
                
                // Quiet Hours
                if (policy.quietHours) {
                    document.getElementById('policy-quiet-enabled').checked = policy.quietHours.enabled ?? true;
                    document.getElementById('policy-quiet-start').value = policy.quietHours.startTime || '22:00';
                    document.getElementById('policy-quiet-end').value = policy.quietHours.endTime || '07:00';
                    document.getElementById('policy-quiet-timezone').value = policy.quietHours.timezone || 'America/New_York';
                    document.getElementById('policy-quiet-allow-critical').checked = policy.quietHours.allowCritical ?? true;
                    document.getElementById('policy-quiet-defer-warnings').checked = policy.quietHours.deferWarnings ?? true;
                }
                
                // Smart Grouping
                if (policy.smartGrouping) {
                    document.getElementById('policy-grouping-enabled').checked = policy.smartGrouping.enabled ?? true;
                    document.getElementById('policy-grouping-threshold').value = policy.smartGrouping.threshold || 3;
                    document.getElementById('policy-grouping-window').value = policy.smartGrouping.windowMinutes || 15;
                }
                
                console.log('✅ [SETTINGS] Notification policy loaded');
            } else {
                console.log('ℹ️ [SETTINGS] No notification policy configured, using defaults');
            }
            
        } catch (error) {
            console.error('❌ [SETTINGS] Failed to load notification policy:', error);
        }
    }
    
    async saveNotificationPolicy() {
        try {
            this.nc.showToast('Saving notification policy...', 'info');
            
            const policy = {
                severityRules: {
                    CRITICAL: {
                        sendSMS: document.getElementById('policy-critical-sms').checked,
                        sendEmail: document.getElementById('policy-critical-email').checked,
                        logOnly: document.getElementById('policy-critical-logonly').checked
                    },
                    WARNING: {
                        sendSMS: document.getElementById('policy-warning-sms').checked,
                        sendEmail: document.getElementById('policy-warning-email').checked,
                        logOnly: document.getElementById('policy-warning-logonly').checked
                    },
                    INFO: {
                        sendSMS: document.getElementById('policy-info-sms').checked,
                        sendEmail: document.getElementById('policy-info-email').checked,
                        logOnly: document.getElementById('policy-info-logonly').checked
                    }
                },
                dailyDigest: {
                    enabled: document.getElementById('policy-digest-enabled').checked,
                    time: document.getElementById('policy-digest-time').value,
                    timezone: document.getElementById('policy-digest-timezone').value
                },
                quietHours: {
                    enabled: document.getElementById('policy-quiet-enabled').checked,
                    startTime: document.getElementById('policy-quiet-start').value,
                    endTime: document.getElementById('policy-quiet-end').value,
                    timezone: document.getElementById('policy-quiet-timezone').value,
                    allowCritical: document.getElementById('policy-quiet-allow-critical').checked,
                    deferWarnings: document.getElementById('policy-quiet-defer-warnings').checked
                },
                smartGrouping: {
                    enabled: document.getElementById('policy-grouping-enabled').checked,
                    threshold: parseInt(document.getElementById('policy-grouping-threshold').value),
                    windowMinutes: parseInt(document.getElementById('policy-grouping-window').value)
                }
            };
            
            console.log('💾 [SETTINGS] Saving policy:', policy);
            
            const data = await this.nc.apiPut('/api/admin/notifications/policy', { notificationPolicy: policy });
            
            if (data.success) {
                this.nc.showSuccess('✅ Notification policy saved successfully!');
            } else {
                this.nc.showError(`Failed to save policy: ${data.error || 'Unknown error'}`);
            }
            
        } catch (error) {
            console.error('❌ [SETTINGS] Failed to save notification policy:', error);
            this.nc.showError(`Error: ${error.message}`);
        }
    }
    
    async resetNotificationPolicy() {
        if (!confirm('Reset notification policy to recommended defaults?\n\nThis will:\n- CRITICAL: SMS + Email\n- WARNING: Email only\n- INFO: Log only\n- Daily digest at 8 AM ET\n- Quiet hours 10 PM - 7 AM ET\n- Smart grouping enabled')) {
            return;
        }
        
        try {
            this.nc.showToast('Resetting to defaults...', 'info');
            
            const response = await this.nc.apiGet('/api/admin/notifications/policy/defaults');
            
            if (response.success && response.data) {
                const defaults = response.data;
                
                // Apply defaults to form
                // CRITICAL
                document.getElementById('policy-critical-sms').checked = defaults.severityRules.CRITICAL.sendSMS;
                document.getElementById('policy-critical-email').checked = defaults.severityRules.CRITICAL.sendEmail;
                document.getElementById('policy-critical-logonly').checked = defaults.severityRules.CRITICAL.logOnly;
                
                // WARNING
                document.getElementById('policy-warning-sms').checked = defaults.severityRules.WARNING.sendSMS;
                document.getElementById('policy-warning-email').checked = defaults.severityRules.WARNING.sendEmail;
                document.getElementById('policy-warning-logonly').checked = defaults.severityRules.WARNING.logOnly;
                
                // INFO
                document.getElementById('policy-info-sms').checked = defaults.severityRules.INFO.sendSMS;
                document.getElementById('policy-info-email').checked = defaults.severityRules.INFO.sendEmail;
                document.getElementById('policy-info-logonly').checked = defaults.severityRules.INFO.logOnly;
                
                // Daily Digest
                document.getElementById('policy-digest-enabled').checked = defaults.dailyDigest.enabled;
                document.getElementById('policy-digest-time').value = defaults.dailyDigest.time;
                document.getElementById('policy-digest-timezone').value = defaults.dailyDigest.timezone;
                
                // Quiet Hours
                document.getElementById('policy-quiet-enabled').checked = defaults.quietHours.enabled;
                document.getElementById('policy-quiet-start').value = defaults.quietHours.startTime;
                document.getElementById('policy-quiet-end').value = defaults.quietHours.endTime;
                document.getElementById('policy-quiet-timezone').value = defaults.quietHours.timezone;
                document.getElementById('policy-quiet-allow-critical').checked = defaults.quietHours.allowCritical;
                document.getElementById('policy-quiet-defer-warnings').checked = defaults.quietHours.deferWarnings;
                
                // Smart Grouping
                document.getElementById('policy-grouping-enabled').checked = defaults.smartGrouping.enabled;
                document.getElementById('policy-grouping-threshold').value = defaults.smartGrouping.threshold;
                document.getElementById('policy-grouping-window').value = defaults.smartGrouping.windowMinutes;
                
                this.nc.showSuccess('✅ Reset to defaults! Click "Save" to apply.');
            }
            
        } catch (error) {
            console.error('❌ [SETTINGS] Failed to reset policy:', error);
            this.nc.showError(`Error: ${error.message}`);
        }
    }
    
    // ========================================================================
    // EVENT HANDLERS
    // ========================================================================
    
    attachEventHandlers() {
        // Twilio save button
        const twilioBtn = document.getElementById('save-twilio-btn');
        if (twilioBtn) {
            twilioBtn.addEventListener('click', () => this.saveTwilioCredentials());
        }
        
        // Test call save button
        const testCallBtn = document.getElementById('save-test-call-btn');
        if (testCallBtn) {
            testCallBtn.addEventListener('click', () => this.saveTestCallConfig());
        }
        
        // Add contact button
        const addBtn = document.getElementById('add-contact-btn');
        if (addBtn) {
            addBtn.addEventListener('click', () => this.addAdminContact());
        }
        
        // Escalation save button
        const escalationBtn = document.getElementById('save-escalation-btn');
        if (escalationBtn) {
            escalationBtn.addEventListener('click', () => this.saveEscalationSettings());
        }
        
        // Notification Policy save button
        const policyBtn = document.getElementById('save-policy-btn');
        if (policyBtn) {
            policyBtn.addEventListener('click', () => this.saveNotificationPolicy());
        }
        
        // Alert Thresholds save button
        const thresholdsBtn = document.getElementById('save-thresholds-btn');
        if (thresholdsBtn) {
            thresholdsBtn.addEventListener('click', () => this.saveAlertThresholds());
        }
        
        // Diagnose Failure button
        const diagnoseBtn = document.getElementById('diagnose-failure-btn');
        if (diagnoseBtn) {
            diagnoseBtn.addEventListener('click', () => this.diagnoseFailure());
        }
        
        // Make this instance globally accessible for remove buttons
        window.settingsManager = this;
    }
    
    // ========================================================================
    // REDIS STATUS BANNER (AUTO-REFRESH, NO BUTTON PRESS)
    // ========================================================================
    
    classifyRedisHealth(redisSection) {
        // redisSection is incidentPacket.redis
        // NOW USES BACKEND-PROVIDED healthLevel, healthHeadline, healthDetail
        
        if (!redisSection) {
            return {
                level: 'CRITICAL',
                icon: '🔴',
                bg: '#7f1d1d',
                fg: '#fff',
                headline: 'REDIS STATUS: UNKNOWN',
                detail: 'No Redis data in incident packet.'
            };
        }
        
        // If backend sent explicit classification, use it (new behavior)
        if (redisSection.healthLevel) {
            let icon = '🟢';
            let bg = '#065f46'; // green
            
            if (redisSection.healthLevel === 'WARNING') {
                icon = '🟡';
                bg = '#92400e'; // amber
            } else if (redisSection.healthLevel === 'CRITICAL') {
                icon = '🔴';
                bg = '#7f1d1d'; // red
            }
            
            return {
                level: redisSection.healthLevel,
                icon: icon,
                bg: bg,
                fg: '#fff',
                headline: `REDIS STATUS: ${redisSection.healthLevel}`,
                detail: redisSection.healthDetail || redisSection.healthHeadline || 'No detail'
            };
        }
        
        // FALLBACK: Old logic for backward compatibility (if backend doesn't send healthLevel)
        if (!redisSection.setGetDelOk) {
            return {
                level: 'CRITICAL',
                icon: '🔴',
                bg: '#7f1d1d',
                fg: '#fff',
                headline: 'REDIS STATUS: CRITICAL',
                detail: 'Cannot SET/GET/DEL. Redis is unreachable or auth is failing. Live traffic may be impacted.'
            };
        }
        
        // If we got here, backend is old and didn't send healthLevel - return generic healthy
        return {
            level: 'HEALTHY',
            icon: '🟢',
            bg: '#065f46',
            fg: '#fff',
            headline: 'REDIS STATUS: HEALTHY',
            detail: 'All tests passed (legacy check).'
        };
    }
    
    renderRedisStatusBanner(incidentPacket) {
        const banner = document.getElementById('redisStatusBanner');
        const iconEl = document.getElementById('redisStatusIcon');
        const headlineEl = document.getElementById('redisStatusHeadline');
        const detailEl = document.getElementById('redisStatusDetail');
        const metaEl = document.getElementById('redisStatusMeta');
        
        if (!banner || !iconEl || !headlineEl || !detailEl || !metaEl) {
            console.warn('[REDIS STATUS] Banner container missing in DOM');
            return;
        }
        
        const cls = this.classifyRedisHealth(incidentPacket?.redis || null);
        
        // Style banner color depending on severity
        banner.style.background = cls.bg;
        banner.style.color = cls.fg;
        banner.style.border = `1px solid ${cls.bg}`;
        
        iconEl.textContent = cls.icon;
        headlineEl.textContent = cls.headline;
        detailEl.textContent = cls.detail;
        
        // Timestamp for "Last check"
        const ts = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'});
        metaEl.textContent = `Last check: ${ts}`;
        
        console.log(`🚦 [REDIS STATUS] ${cls.level} - ${cls.detail}`);
    }
    
    // ========================================================================
    // CRITICAL FAILURE CARD RENDERER
    // ========================================================================
    
    renderCriticalFailureCard(incidentPacket) {
        const card = document.getElementById('criticalFailureCard');
        if (!card) return; // fail-safe
        
        if (!incidentPacket || incidentPacket.overallStatus !== 'FAIL') {
            card.style.display = 'none';
            return;
        }
        
        // show card
        card.style.display = 'block';
        
        // summary line
        const summaryEl = document.getElementById('criticalSummary');
        if (summaryEl) {
            summaryEl.textContent = incidentPacket.summary || 'No summary provided.';
        }
        
        // failure source
        const sourceEl = document.getElementById('criticalSource');
        if (sourceEl) {
            sourceEl.textContent = `Failure Source: ${incidentPacket.failureSource || 'unknown'}`;
        }
        
        // build IMMEDIATE ACTIONS list
        const actionsEl = document.getElementById('criticalActions');
        if (actionsEl) {
            actionsEl.innerHTML = ''; // clear any old
            const actions = Array.isArray(incidentPacket.actions) && incidentPacket.actions.length
                ? incidentPacket.actions.slice()
                : [];
            
            // inject the missing step about ensuring the route actually exists
            // only add if not already present
            const extraStep =
                "Also confirm routes/admin/adminNotifications.js defines GET /thresholds and POST /thresholds so the route actually exists.";
            if (!actions.find(a => a.includes('adminNotifications.js'))) {
                actions.push(extraStep);
            }
            
            actions.forEach(step => {
                const li = document.createElement('li');
                li.textContent = step;
                actionsEl.appendChild(li);
            });
        }
    }
    
    injectKillOrderText(killOrderText) {
        const pre = document.getElementById('killOrderDetails');
        if (!pre) return;
        pre.textContent = killOrderText || '(no details)';
    }
    
    // ========================================================================
    // DIAGNOSE FAILURE - SHOW KILL ORDER
    // ========================================================================
    
    diagnoseFailure() {
        const packet = window.LatestIncidentPacket;
        
        if (!packet) {
            alert('❌ No diagnostic packet available yet.\n\nRun "Test Connection" first to generate a diagnostic report.');
            return;
        }
        
        if (packet.overallStatus === 'OK') {
            alert('✅ All systems OK. No active failure to diagnose.\n\nEverything is operational!');
            return;
        }
        
        // Build the kill order
        const httpStatus = packet.app?.routes?.find(r => r.status !== 200)?.status || 'N/A';
        const timestamp = new Date().toLocaleString();
        
        const lines = [
            '╔══════════════════════════════════════════════════════════════════════════╗',
            '║ 🚨 DIAGNOSE FAILURE - KILL ORDER                                        ║',
            '╚══════════════════════════════════════════════════════════════════════════╝',
            '',
            `STATUS: ${packet.overallStatus}`,
            `SOURCE: ${packet.failureSource || 'unknown'}`,
            `SUMMARY: ${packet.summary || 'n/a'}`,
            `HTTP STATUS: ${httpStatus}`,
            `GENERATED: ${timestamp}`,
            '',
            '═══════════════════════════════════════════════════════════════════════════',
            'REQUIRED ACTIONS:',
            '═══════════════════════════════════════════════════════════════════════════',
            '',
            ...(packet.actions && packet.actions.length ? 
                packet.actions.map((a, i) => `${i + 1}. ${a}`) : 
                ['(none reported)']),
            '',
            '═══════════════════════════════════════════════════════════════════════════',
            'DEPLOY INFO:',
            '═══════════════════════════════════════════════════════════════════════════',
            '',
            `Deployed Commit: ${packet.app?.deployedCommit || 'n/a'}`,
            `Expected Commit: ${packet.app?.uiExpectedCommit || 'n/a'}`,
            `Commit Mismatch: ${packet.app?.commitMismatch ? 'YES ⚠️' : 'NO'}`,
            '',
            '═══════════════════════════════════════════════════════════════════════════',
            'SERVICE IMPACT:',
            '═══════════════════════════════════════════════════════════════════════════',
            '',
            packet.failureSource === 'ROUTE_DEPLOY' ? 
                'Admin cannot read/save alert thresholds. Live customer traffic is still being served.' :
            packet.failureSource === 'REDIS' ?
                'Cache unavailable. Performance degraded. Customer data may not persist between requests.' :
            packet.failureSource === 'MONGO' ?
                'Database slow. All operations affected. Customers experiencing delays.' :
            packet.failureSource === 'NODE_RUNTIME' ?
                'Server overloaded. Response times high. Scale immediately.' :
                'See packet details above.',
            '',
            '═══════════════════════════════════════════════════════════════════════════',
            `Generated: ${new Date().toLocaleString()}`,
            '═══════════════════════════════════════════════════════════════════════════'
        ];
        
        const killOrder = lines.join('\n');
        
        // Inject kill order into the critical failure card
        this.injectKillOrderText(killOrder);
        
        // Copy to clipboard
        navigator.clipboard.writeText(killOrder).then(() => {
            alert('✅ KILL ORDER COPIED TO CLIPBOARD!\n\nPaste this to your dev team or into a terminal.\n\nThis tells you:\n• What failed\n• Why it failed\n• What to do in next 60 seconds\n• Service impact');
        }).catch(() => {
            // Fallback if clipboard fails - show in alert
            alert(killOrder);
        });
        
        console.log('🚨 [DIAGNOSE] Kill Order:', killOrder);
    }
    
    // ========================================================================
    // ALERT THRESHOLDS
    // ========================================================================
    
    async loadAlertThresholds() {
        try {
            const response = await this.nc.apiGet('/api/admin/notifications/thresholds');
            
            if (response.success && response.data) {
                const thresholds = response.data;
                
                // Redis thresholds
                if (thresholds.redis) {
                    if (thresholds.redis.hitRate !== undefined) {
                        document.getElementById('redis-hit-rate-threshold').value = thresholds.redis.hitRate;
                    }
                    if (thresholds.redis.memory !== undefined) {
                        document.getElementById('redis-memory-threshold').value = thresholds.redis.memory;
                    }
                    if (thresholds.redis.latency !== undefined) {
                        document.getElementById('redis-latency-threshold').value = thresholds.redis.latency;
                    }
                }
                
                // Update slider labels
                if (typeof updateSliderLabels === 'function') {
                    updateSliderLabels();
                }
                
                console.log('✅ [SETTINGS] Alert thresholds loaded');
            } else {
                console.log('ℹ️ [SETTINGS] No custom thresholds set, using defaults');
            }
            
        } catch (error) {
            console.error('❌ [SETTINGS] Failed to load alert thresholds:', error);
        }
    }
    
    async testThresholdConnection() {
        console.log('🚨 [SETTINGS] Running ER Triage Monitor...');
        
        const banner = document.getElementById('threshold-test-banner');
        const icon = document.getElementById('threshold-test-icon');
        const title = document.getElementById('threshold-test-title');
        const message = document.getElementById('threshold-test-message');
        const details = document.getElementById('threshold-test-details');
        
        // Hide banner before starting test
        banner.classList.add('hidden');
        
        try {
            // Call the ER Triage Monitor
            const incidentPacket = await this.nc.apiPost('/api/admin/diag/selfcheck', {});
            
            // CRITICAL: Save incident packet globally for Diagnose Failure button
            window.LatestIncidentPacket = incidentPacket;
            
            console.log('🎯 [SETTINGS] Incident Packet:', incidentPacket);
            
            // Render critical failure card if FAIL status
            this.renderCriticalFailureCard(incidentPacket);
            
            // Render Redis status banner (auto-refresh, no button press)
            this.renderRedisStatusBanner(incidentPacket);
            
            // Display based on overallStatus
            if (incidentPacket.overallStatus === 'OK') {
                // GREEN: All systems operational
                banner.className = 'mt-6 p-4 rounded-lg border-l-4 border-green-500 bg-green-50';
                icon.className = 'fas fa-check-circle text-green-600 text-2xl mr-3';
                title.innerHTML = '✅ ALL SYSTEMS OPERATIONAL';
                message.innerHTML = `
                    <div class="space-y-2">
                        <p class="text-sm font-semibold text-green-700">${incidentPacket.summary}</p>
                        <div class="grid grid-cols-4 gap-2 text-xs mt-2">
                            <div class="p-2 bg-white rounded border border-green-200">
                                <strong>Redis:</strong> ${incidentPacket.redis.setGetDelOk ? '✅ OK' : '❌ FAIL'}<br>
                                <span class="text-gray-600">${incidentPacket.redis.roundTripMs}ms</span>
                            </div>
                            <div class="p-2 bg-white rounded border border-green-200">
                                <strong>MongoDB:</strong> ${incidentPacket.mongo.quickQueryOk ? '✅ OK' : '❌ FAIL'}<br>
                                <span class="text-gray-600">${incidentPacket.mongo.roundTripMs}ms</span>
                            </div>
                            <div class="p-2 bg-white rounded border border-green-200">
                                <strong>Routes:</strong> ${incidentPacket.app.routes?.every(r => r.status === 200) ? '✅ OK' : '⚠️ WARN'}<br>
                                <span class="text-gray-600">${incidentPacket.app.routes?.length || 0} checked</span>
                            </div>
                            <div class="p-2 bg-white rounded border border-green-200">
                                <strong>Event Loop:</strong> ✅ OK<br>
                                <span class="text-gray-600">${incidentPacket.app.eventLoopDelayMs}ms</span>
                            </div>
                        </div>
                    </div>
                `;
            } else if (incidentPacket.overallStatus === 'WARN') {
                // YELLOW: Warnings detected
                banner.className = 'mt-6 p-4 rounded-lg border-l-4 border-yellow-500 bg-yellow-50';
                icon.className = 'fas fa-exclamation-triangle text-yellow-600 text-2xl mr-3';
                title.innerHTML = '⚠️ WARNINGS DETECTED';
                message.innerHTML = `
                    <div class="space-y-2">
                        <p class="text-sm font-semibold text-yellow-700">${incidentPacket.summary}</p>
                        <p class="text-xs text-gray-600">Failure Source: <strong>${incidentPacket.failureSource || 'N/A'}</strong></p>
                        ${incidentPacket.actions.length ? `
                        <div class="mt-2 p-2 bg-white rounded border border-yellow-200">
                            <strong class="text-xs">Action Required:</strong>
                            <ul class="text-xs text-gray-700 mt-1 list-disc list-inside">
                                ${incidentPacket.actions.map(a => `<li>${a}</li>`).join('')}
                            </ul>
                        </div>
                        ` : ''}
                    </div>
                `;
            } else {
                // RED: Critical failure
                banner.className = 'mt-6 p-4 rounded-lg border-l-4 border-red-500 bg-red-50';
                icon.className = 'fas fa-times-circle text-red-600 text-2xl mr-3';
                title.innerHTML = '🚨 CRITICAL FAILURE DETECTED';
                message.innerHTML = `
                    <div class="space-y-2">
                        <p class="text-sm font-bold text-red-700">${incidentPacket.summary}</p>
                        <p class="text-xs text-gray-600">Failure Source: <strong class="text-red-600">${incidentPacket.failureSource}</strong></p>
                        ${incidentPacket.actions.length ? `
                        <div class="mt-2 p-2 bg-white rounded border border-red-200">
                            <strong class="text-xs text-red-700">IMMEDIATE ACTIONS:</strong>
                            <ol class="text-xs text-gray-700 mt-1 list-decimal list-inside">
                                ${incidentPacket.actions.map(a => `<li class="font-semibold">${a}</li>`).join('')}
                            </ol>
                        </div>
                        ` : ''}
                    </div>
                `;
            }
            
            // Build full incident report
            const reportText = this.buildIncidentReport(incidentPacket);
            details.innerHTML = `
                <div class="flex items-center justify-between mb-2">
                    <span class="font-semibold">🚨 ER TRIAGE REPORT:</span>
                    <button onclick="navigator.clipboard.writeText(document.getElementById('threshold-report-text').textContent).then(() => alert('✅ Incident packet copied!'))" class="bg-blue-600 hover:bg-blue-700 text-white text-xs px-3 py-1 rounded">
                        <i class="fas fa-copy mr-1"></i> Copy Full Incident Packet
                    </button>
                </div>
                <pre id="threshold-report-text" class="whitespace-pre-wrap text-xs">${reportText}</pre>
            `;
            details.classList.remove('hidden');
            
        } catch (error) {
            console.error('❌ [SETTINGS] ER Triage failed:', error);
            
            banner.className = 'mt-6 p-4 rounded-lg border-l-4 border-red-500 bg-red-50';
            icon.className = 'fas fa-times-circle text-red-600 text-2xl mr-3';
            title.innerHTML = '🚨 TRIAGE ENDPOINT UNREACHABLE';
            message.innerHTML = `
                <p class="text-sm text-red-700 font-bold">Cannot reach ER Triage Monitor endpoint</p>
                <p class="text-xs text-gray-600 mt-1">Error: ${error.message}</p>
            `;
            details.innerHTML = '';
        }
        
        // Show banner
        banner.classList.remove('hidden');
    }
    
    categorizeError(error) {
        const msg = error.message.toLowerCase();
        if (msg.includes('404')) return '404_NOT_FOUND';
        if (msg.includes('403')) return '403_FORBIDDEN';
        if (msg.includes('500')) return '500_SERVER_ERROR';
        if (msg.includes('network')) return 'NETWORK_ERROR';
        if (msg.includes('timeout')) return 'TIMEOUT';
        return 'UNKNOWN_ERROR';
    }
    
    getErrorMessage(errorType) {
        const messages = {
            '404_NOT_FOUND': `
                <strong>🚨 API Endpoints Not Deployed</strong><br>
                The threshold endpoints are missing from production.<br>
                <strong>Most likely:</strong> Render hasn't deployed the latest code yet.
            `,
            '403_FORBIDDEN': `
                <strong>🔒 Access Denied</strong><br>
                Your account doesn't have admin permissions.<br>
                <strong>Action:</strong> Verify your JWT token and admin role.
            `,
            '500_SERVER_ERROR': `
                <strong>💥 Server Error</strong><br>
                The backend crashed while processing your request.<br>
                <strong>Action:</strong> Check Render logs for stack traces.
            `,
            'NETWORK_ERROR': `
                <strong>🌐 Network Issue</strong><br>
                Cannot reach the backend server.<br>
                <strong>Action:</strong> Check if Render service is running.
            `,
            'TIMEOUT': `
                <strong>⏱️ Request Timeout</strong><br>
                The server is taking too long to respond.<br>
                <strong>Action:</strong> Check if Render is cold-starting.
            `
        };
        return messages[errorType] || `<strong>❓ Unknown Error</strong><br>${errorType}`;
    }
    
    async runFullDiagnostics(report) {
        // Test 2: AUTOMATED Render Environment Check
        try {
            const envCheck = await this.nc.apiGet('/api/admin/diag/full-health-check');
            if (envCheck.success) {
                report.results.renderEnvironment = envCheck.report;
            }
        } catch (e) {
            report.results.renderEnvironment = {
                status: 'FAILED',
                error: 'Could not reach automated health check endpoint'
            };
        }
        
        // Test 3: Check authentication
        const token = localStorage.getItem('adminToken');
        report.results.authentication = {
            tokenPresent: !!token,
            tokenLength: token ? token.length : 0
        };
        
        // Test 4: Browser info
        report.results.browser = {
            userAgent: navigator.userAgent,
            timestamp: new Date().toLocaleString(),
            url: window.location.href
        };
    }
    
    buildSuccessReport(report) {
        return `
╔══════════════════════════════════════════════════════════════════════════════╗
║ ✅ ALERT THRESHOLDS API - DIAGNOSTIC REPORT (SUCCESS)                       ║
╚══════════════════════════════════════════════════════════════════════════════╝

📅 TIMESTAMP: ${new Date().toLocaleString()}
🌐 ENDPOINT: GET /api/admin/notifications/thresholds
✅ STATUS: ALL SYSTEMS OPERATIONAL

═══════════════════════════════════════════════════════════════════════════════
📊 TEST RESULTS:
═══════════════════════════════════════════════════════════════════════════════

✅ Threshold API: SUCCESS
   Response Time: ${report.results.thresholdAPI.responseTime}
   
   Current Thresholds:
   • Hit Rate: ${report.results.thresholdAPI.data?.redis?.hitRate}%
   • Memory: ${report.results.thresholdAPI.data?.redis?.memory}%
   • Latency: ${report.results.thresholdAPI.data?.redis?.latency}ms

═══════════════════════════════════════════════════════════════════════════════
🎯 NEXT STEPS:
═══════════════════════════════════════════════════════════════════════════════

✅ Everything is working! You can now:
   1. Adjust thresholds using the sliders above
   2. Click "Save Alert Thresholds" to persist changes
   3. Changes will take effect on the next health check

═══════════════════════════════════════════════════════════════════════════════
Generated: ${new Date().toISOString()}
Platform: ClientsVia Notification Center
Environment: Production
═══════════════════════════════════════════════════════════════════════════════
`.trim();
    }
    
    buildFailureReport(report, errorType) {
        const env = report.results.renderEnvironment;
        const mongoStatus = env?.checks?.mongodb?.status || 'UNKNOWN';
        const redisStatus = env?.checks?.redis?.status || 'UNKNOWN';
        const envVarStatus = env?.checks?.environment?.status || 'UNKNOWN';
        const missingVars = env?.checks?.environment?.required?.missing || [];
        const renderCommit = env?.checks?.renderEnvironment?.commit || 'unknown';
        
        return `
╔══════════════════════════════════════════════════════════════════════════════╗
║ 🔍 AUTOMATED ENVIRONMENT DIAGNOSTIC REPORT                                   ║
╚══════════════════════════════════════════════════════════════════════════════╝

📅 TIMESTAMP: ${new Date().toLocaleString()}
🌐 ENDPOINT: GET /api/admin/notifications/thresholds
❌ STATUS: ${errorType}

═══════════════════════════════════════════════════════════════════════════════
🤖 AUTOMATED HEALTH CHECKS (FROM RENDER):
═══════════════════════════════════════════════════════════════════════════════

${mongoStatus === 'HEALTHY' ? '✅' : '❌'} MongoDB: ${mongoStatus}
   ${env?.checks?.mongodb?.host || 'N/A'} | ${env?.checks?.mongodb?.database || 'N/A'}
   Response Time: ${env?.checks?.mongodb?.responseTime || 'N/A'}

${redisStatus === 'HEALTHY' ? '✅' : '🔴'} Redis: ${redisStatus}
   ${redisStatus === 'HEALTHY' ? 
     `Response Time: ${env?.checks?.redis?.responseTime || 'N/A'}\n   Memory: ${env?.checks?.redis?.memory || 'N/A'}\n   Clients: ${env?.checks?.redis?.clients || 0}` :
     `Error: ${env?.checks?.redis?.error || 'Not connected'}\n   ⚠️ This is likely causing the issues!`}

${envVarStatus === 'HEALTHY' ? '✅' : '❌'} Environment Variables: ${envVarStatus}
   Present: ${env?.checks?.environment?.required?.present || 0}/${env?.checks?.environment?.required?.total || 6}
   ${missingVars.length > 0 ? `Missing: ${missingVars.join(', ')}` : 'All required vars present'}

📦 Render Deployment Info:
   Commit: ${renderCommit}
   Service: ${env?.checks?.renderEnvironment?.service || 'unknown'}
   Region: ${env?.checks?.renderEnvironment?.region || 'unknown'}

${report.results.authentication ? `
${report.results.authentication.tokenPresent ? '✅' : '❌'} Authentication Token: ${report.results.authentication.tokenPresent ? 'Present' : 'Missing'}
   Token Length: ${report.results.authentication.tokenLength} chars
` : ''}

═══════════════════════════════════════════════════════════════════════════════
🔍 ROOT CAUSE ANALYSIS:
═══════════════════════════════════════════════════════════════════════════════

${this.getRootCauseAnalysis(errorType, report)}

═══════════════════════════════════════════════════════════════════════════════
🔧 RECOMMENDED FIX:
═══════════════════════════════════════════════════════════════════════════════

${this.getRecommendedFix(errorType, report)}

═══════════════════════════════════════════════════════════════════════════════
🖥️ ENVIRONMENT INFO:
═══════════════════════════════════════════════════════════════════════════════

Browser: ${report.results.browser?.userAgent || 'Unknown'}
Current URL: ${report.results.browser?.url || 'Unknown'}
Timestamp: ${report.results.browser?.timestamp || 'Unknown'}

═══════════════════════════════════════════════════════════════════════════════
📝 NEXT STEPS FOR AI ASSISTANT:
═══════════════════════════════════════════════════════════════════════════════

Copy this entire report and paste it to your AI assistant with the message:
"Fix this Alert Thresholds API issue"

The AI will:
1. Analyze the root cause
2. Check if code is deployed to Render
3. Verify route mounting and middleware
4. Provide step-by-step fix instructions

═══════════════════════════════════════════════════════════════════════════════
Generated: ${new Date().toISOString()}
Platform: ClientsVia Notification Center
Environment: Production
═══════════════════════════════════════════════════════════════════════════════

Paste this report to your AI assistant for instant root cause analysis!
`.trim();
    }
    
    getRootCauseAnalysis(errorType, report) {
        const env = report.results.renderEnvironment;
        const redisStatus = env?.checks?.redis?.status;
        const missingVars = env?.checks?.environment?.required?.missing || [];
        const issues = env?.issues || [];
        const fixes = env?.fixes || [];
        
        // SMART ANALYSIS: Use actual automated checks
        let smartAnalysis = '';
        
        if (redisStatus === 'DOWN' || redisStatus === 'ERROR') {
            smartAnalysis = `
🔴 CRITICAL: Redis is DOWN
   ${env?.checks?.redis?.error || 'Connection failed'}
   
   This is the PRIMARY issue affecting your system!`;
        }
        
        if (missingVars.length > 0) {
            smartAnalysis += `
   
❌ Missing Environment Variables: ${missingVars.join(', ')}
   These must be added in Render dashboard.`;
        }
        
        if (issues.length > 0) {
            smartAnalysis += `
   
📋 Detected Issues:
${issues.map(i => '   • ' + i).join('\n')}`;
        }
        
        const analysis = {
            '404_NOT_FOUND': smartAnalysis || `
The threshold API endpoints (GET/POST /thresholds) are returning 404.

Automated checks show:
${JSON.stringify(env?.checks, null, 2)}`,

            '403_FORBIDDEN': `
The backend rejected your authentication token.

Possible causes:
1. JWT token expired (check token exp claim)
2. User role is not 'admin' (requireRole('admin') middleware)
3. Session invalidated on backend`,

            '500_SERVER_ERROR': `
The backend crashed while processing the request.

Check Render logs for:
1. Database connection errors (MongoDB)
2. Missing AdminSettings model import
3. Mongoose validation errors
4. Redis connection issues`,

            'NETWORK_ERROR': `
Cannot reach the backend server at all.

Possible causes:
1. Render service is stopped/crashed
2. DNS resolution failure
3. CORS blocking the request
4. Network firewall/proxy issue`
        };
        
        return analysis[errorType] || `Unknown error type: ${errorType}`;
    }
    
    getRecommendedFix(errorType, report) {
        const env = report?.results?.renderEnvironment;
        const autoFixes = env?.fixes || [];
        
        // Use AUTOMATED fixes if available
        if (autoFixes.length > 0) {
            return `
🤖 AUTOMATED FIX RECOMMENDATIONS:

${autoFixes.map((fix, i) => `${i + 1}. ${fix}`).join('\n\n')}

💡 These are automatically generated based on actual system checks,
   not generic suggestions!`;
        }
        
        // Fallback to manual steps if automated checks failed
        const fixes = {
            '404_NOT_FOUND': `
STEP 1: Check Render Deploy Status
   → Go to https://dashboard.render.com
   → Find "clientsvia-backend" service
   → Check if latest commit is deployed
   → If not, click "Manual Deploy" → "Deploy latest commit"

STEP 2: Check Environment Variables
   → Render dashboard → Environment tab
   → Verify all required vars are present

STEP 3: Wait for Deploy
   → Render deploy takes 2-3 minutes
   → Refresh this page after deploy completes
   → Click "Test Connection" again`,

            '403_FORBIDDEN': `
STEP 1: Check JWT Token
   → Open DevTools Console
   → Run: localStorage.getItem('adminToken')
   → Verify token is present and not expired

STEP 2: Check User Role
   → The /thresholds endpoint requires admin role
   → Verify your user account has role: 'admin'

STEP 3: Re-login
   → Logout and login again to get fresh token
   → Try "Test Connection" again`,

            '500_SERVER_ERROR': `
STEP 1: Check Render Logs
   → Go to Render dashboard
   → Click "Logs" tab
   → Look for error stack traces around ${new Date().toISOString()}

STEP 2: Common Fixes
   → Verify AdminSettings model is imported
   → Check MongoDB connection is healthy
   → Ensure alertThresholds field exists in schema

STEP 3: Restart Service
   → Sometimes a restart clears stuck states
   → Render dashboard → "Manual Deploy" → "Clear build cache"`,

            'NETWORK_ERROR': `
STEP 1: Check Render Service
   → Go to https://dashboard.render.com
   → Verify service is "Live" (not "Suspended")

STEP 2: Check DNS
   → Try: https://clientsvia-backend.onrender.com/health
   → Should return 200 OK

STEP 3: Check CORS
   → Verify backend allows requests from your domain
   → Check middleware/helmet.js CORS config`
        };
        
        return fixes[errorType] || 'No specific fix available. Contact support with this report.';
    }
    
    async saveAlertThresholds() {
        try {
            const hitRate = parseInt(document.getElementById('redis-hit-rate-threshold').value);
            const memory = parseInt(document.getElementById('redis-memory-threshold').value);
            const latency = parseInt(document.getElementById('redis-latency-threshold').value);
            
            // Validate
            if (hitRate < 30 || hitRate > 90) {
                alert('❌ Hit Rate must be between 30% and 90%');
                return;
            }
            if (memory < 50 || memory > 95) {
                alert('❌ Memory threshold must be between 50% and 95%');
                return;
            }
            if (latency < 50 || latency > 500) {
                alert('❌ Latency threshold must be between 50ms and 500ms');
                return;
            }
            
            const response = await this.nc.apiPost('/api/admin/notifications/thresholds', {
                redis: {
                    hitRate,
                    memory,
                    latency
                }
            });
            
            if (response.success) {
                alert(`✅ Alert thresholds saved successfully!\n\n• Hit Rate: ${hitRate}%\n• Memory: ${memory}%\n• Latency: ${latency}ms\n\nThese will take effect on the next health check.`);
                console.log('✅ [SETTINGS] Alert thresholds saved');
            } else {
                throw new Error(response.message || 'Failed to save thresholds');
            }
            
        } catch (error) {
            console.error('❌ [SETTINGS] Failed to save alert thresholds:', error);
            alert(`❌ Failed to save alert thresholds: ${error.message}`);
        }
    }
    
    // ========================================================================
    // UTILITY
    // ========================================================================
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    // ========================================================================
    // ER TRIAGE MONITOR - BUILD INCIDENT REPORT
    // ========================================================================
    
    buildIncidentReport(packet) {
        const httpStatus = packet.app?.routes?.find(r => r.status !== 200)?.status || 'N/A';
        const timestamp = new Date().toLocaleString();
        
        return `
╔══════════════════════════════════════════════════════════════════════════════╗
║ 🚨 ER TRIAGE MONITOR - INCIDENT PACKET                                      ║
╚══════════════════════════════════════════════════════════════════════════════╝

🎯 OVERALL STATUS: ${packet.overallStatus}
🔍 FAILURE SOURCE: ${packet.failureSource || 'None'}
📝 SUMMARY: ${packet.summary}
🌐 HTTP STATUS: ${httpStatus}
🕐 GENERATED: ${timestamp}

═══════════════════════════════════════════════════════════════════════════════
🔥 IMMEDIATE ACTIONS REQUIRED:
═══════════════════════════════════════════════════════════════════════════════

${packet.actions.length ? packet.actions.map((a, i) => `${i + 1}. ${a}`).join('\n') : 'None - all systems operational'}

═══════════════════════════════════════════════════════════════════════════════
💾 REDIS STATUS:
═══════════════════════════════════════════════════════════════════════════════

SET/GET/DEL Test: ${packet.redis.setGetDelOk ? '✅ PASS' : '❌ FAIL'}
Round Trip Time: ${packet.redis.roundTripMs || 'N/A'}ms
Memory Usage: ${packet.redis.usedMemoryPercent || 0}% (${packet.redis.usedMemoryBytes || 0} bytes)
Evicted Keys: ${packet.redis.evictedKeys || 0} ${packet.redis.evictedKeys > 0 ? '🔥 FIRE ALARM!' : ''}
Rejected Connections: ${packet.redis.rejectedConnections || 0} ${packet.redis.rejectedConnections > 0 ? '🚨 RED ALERT!' : ''}
Connected Clients: ${packet.redis.connectedClients || 0}
Fragmentation Ratio: ${packet.redis.fragmentationRatio || 1.0}
Persistence OK: ${packet.redis.persistenceOk ? '✅ Yes' : '⚠️ NO - DATA LOSS RISK!'}
Key Count (dbsize): ${packet.redis.dbsize || 0}

${packet.redis.notes && packet.redis.notes.length ? `
⚠️ CRITICAL NOTES:
${packet.redis.notes.map(n => '• ' + n).join('\n')}
` : ''}

═══════════════════════════════════════════════════════════════════════════════
🗄️ MONGODB STATUS:
═══════════════════════════════════════════════════════════════════════════════

Quick Query Test: ${packet.mongo.quickQueryOk ? '✅ PASS' : '❌ FAIL'}
Round Trip Time: ${packet.mongo.roundTripMs || 'N/A'}ms

${packet.mongo.notes && packet.mongo.notes.length ? `
⚠️ CRITICAL NOTES:
${packet.mongo.notes.map(n => '• ' + n).join('\n')}
` : ''}

═══════════════════════════════════════════════════════════════════════════════
🌐 ROUTE VERIFICATION:
═══════════════════════════════════════════════════════════════════════════════

${packet.app.routes?.map(r => `
${r.reachable ? '✅' : '❌'} ${r.name}
   URL: ${r.url}
   Status: ${r.status} ${r.statusText || ''}
   Response Time: ${r.timeMs}ms
   ${r.likelyCause ? '⚠️ Cause: ' + r.likelyCause : ''}
   ${r.fix ? '🔧 Fix:\n' + r.fix.map(f => '      • ' + f).join('\n') : ''}
`).join('\n') || 'No routes tested'}

═══════════════════════════════════════════════════════════════════════════════
🖥️ NODE RUNTIME:
═══════════════════════════════════════════════════════════════════════════════

Event Loop Delay: ${packet.app.eventLoopDelayMs}ms ${packet.app.eventLoopDelayMs > 50 ? '⚠️ OVERLOADED!' : '✅ OK'}
Deployed Commit: ${packet.app.deployedCommit}
Expected Commit: ${packet.app.uiExpectedCommit}
Commit Mismatch: ${packet.app.commitMismatch ? '⚠️ YES - DEPLOY DRIFT!' : '✅ No'}

═══════════════════════════════════════════════════════════════════════════════
📊 AUTO-BLAME ANALYSIS:
═══════════════════════════════════════════════════════════════════════════════

${this.getAutoBlameExplanation(packet)}

═══════════════════════════════════════════════════════════════════════════════
🕐 Report Generated: ${new Date().toLocaleString()}
🔗 Copy this packet and share with dev team for instant troubleshooting
═══════════════════════════════════════════════════════════════════════════════
`.trim();
    }
    
    getAutoBlameExplanation(packet) {
        if (packet.failureSource === 'ROUTE_DEPLOY') {
            return `
🎯 FAILURE SOURCE: ROUTE_DEPLOY

The system detected that API routes are returning 404.
This is NOT a Redis or MongoDB issue.
This is a deployment/mounting issue.

What this means:
• Code commit mismatch between UI and backend
• Routes not mounted in index.js
• Render deploy failed or stuck

Next 60 seconds:
1. Go to Render dashboard
2. Deploy latest commit
3. Wait 2-3 minutes
4. Refresh and test again`;
        } else if (packet.failureSource === 'REDIS') {
            return `
🎯 FAILURE SOURCE: REDIS

Redis SET/GET/DEL test failed or Redis not ready.
MongoDB and routes are OK - Redis is the bottleneck.

What this means:
• REDIS_URL missing or incorrect
• Redis service down or unreachable
• Connection limits hit (rejectedConnections > 0)
• Memory pressure causing evictions

Next 60 seconds:
1. Check REDIS_URL in Render env vars
2. Verify Redis service is running
3. If memory% > 90%, upgrade Redis plan
4. If rejectedConnections > 0, increase maxclients`;
        } else if (packet.failureSource === 'MONGO') {
            return `
🎯 FAILURE SOURCE: MONGO

MongoDB query taking ${packet.mongo.roundTripMs}ms - choking Node.
Redis is FINE - MongoDB is blocking the event loop.

What this means:
• Atlas performance degraded
• Missing or inefficient indexes
• Network latency to MongoDB cluster
• Query volume overwhelming MongoDB

Next 60 seconds:
1. Check MongoDB Atlas performance dashboard
2. Review slow query logs
3. Add missing indexes
4. Scale up MongoDB cluster if needed
5. DO NOT TOUCH REDIS - it's innocent!`;
        } else if (packet.failureSource === 'NODE_RUNTIME') {
            return `
🎯 FAILURE SOURCE: NODE_RUNTIME

Event loop stalled at ${packet.app.eventLoopDelayMs}ms.
Redis and MongoDB are OK - Node itself is overloaded.

What this means:
• Long-running synchronous handler
• Infinite loop or CPU spike
• Too many requests for current Node capacity
• Blocking I/O operations

Next 60 seconds:
1. Check Render logs for CPU spikes
2. Investigate recent deploys for sync operations
3. Consider scaling Node instances
4. Profile code for bottlenecks`;
        } else {
            return `
✅ NO CRITICAL FAILURES DETECTED

All systems are operational or have minor warnings.
Check individual component notes above for optimization opportunities.`;
        }
    }
}
