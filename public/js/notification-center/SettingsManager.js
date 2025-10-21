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
            this.loadTestCallGreeting(),
            this.loadAdminContacts(),
            this.loadEscalationSettings()
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
    // TEST CALL GREETING
    // ========================================================================
    
    async loadTestCallGreeting() {
        try {
            const response = await this.nc.apiGet('/api/admin/notifications/settings');
            
            if (response.success && response.data && response.data.testCallGreeting) {
                document.getElementById('test-call-greeting').value = response.data.testCallGreeting;
            } else {
                // Set default greeting if none exists
                document.getElementById('test-call-greeting').value = 
                    'This is a ClientsVia system check. Your Twilio integration is working correctly. If you can hear this message, voice webhooks are properly configured. Thank you for calling.';
            }
            
        } catch (error) {
            console.error('❌ [SETTINGS] Failed to load test call greeting:', error);
        }
    }
    
    async saveTestCallGreeting() {
        try {
            const greeting = document.getElementById('test-call-greeting').value.trim();
            
            if (!greeting) {
                this.nc.showToast('Please enter a greeting message', 'error');
                return;
            }
            
            const data = await this.nc.apiPut('/api/admin/notifications/settings', {
                testCallGreeting: greeting
            });
            
            if (data.success) {
                this.nc.showToast('Test call greeting saved successfully', 'success');
            } else {
                this.nc.showToast('Failed to save test call greeting', 'error');
            }
            
        } catch (error) {
            console.error('❌ [SETTINGS] Failed to save test call greeting:', error);
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
    // EVENT HANDLERS
    // ========================================================================
    
    attachEventHandlers() {
        // Twilio save button
        const twilioBtn = document.getElementById('save-twilio-btn');
        if (twilioBtn) {
            twilioBtn.addEventListener('click', () => this.saveTwilioCredentials());
        }
        
        // Test greeting save button
        const testGreetingBtn = document.getElementById('save-test-greeting-btn');
        if (testGreetingBtn) {
            testGreetingBtn.addEventListener('click', () => this.saveTestCallGreeting());
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
