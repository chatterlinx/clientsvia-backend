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
            this.loadNotificationPolicy()
        ]);
        
        this.attachEventHandlers();
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
        
        // Make this instance globally accessible for remove buttons
        window.settingsManager = this;
    }
    
    // ========================================================================
    // UTILITY
    // ========================================================================
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
