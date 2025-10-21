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
            this.loadAdminContacts()
        ]);
        
        this.attachEventHandlers();
    }
    
    // ========================================================================
    // TWILIO CREDENTIALS
    // ========================================================================
    
    async loadTwilioCredentials() {
        try {
            const data = await this.nc.apiGet('/api/admin/notifications/settings');
            
            if (data.success && data.settings.twilio) {
                document.getElementById('twilio-account-sid').value = data.settings.twilio.accountSid || '';
                document.getElementById('twilio-auth-token').value = data.settings.twilio.authToken || '';
                document.getElementById('twilio-phone-number').value = data.settings.twilio.phoneNumber || '';
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
    // ADMIN CONTACTS
    // ========================================================================
    
    async loadAdminContacts() {
        try {
            const data = await this.nc.apiGet('/api/admin/notifications/settings');
            
            if (data.success) {
                this.adminContacts = data.settings.adminContacts || [];
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
                            <div class="mt-3 flex gap-2">
                                ${contact.receiveSMS ? '<span class="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">📱 SMS</span>' : ''}
                                ${contact.receiveEmail ? '<span class="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">📧 Email</span>' : ''}
                                ${contact.receiveCalls ? '<span class="text-xs bg-purple-100 text-purple-800 px-2 py-1 rounded">📞 Calls</span>' : ''}
                            </div>
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
    
    // ========================================================================
    // EVENT HANDLERS
    // ========================================================================
    
    attachEventHandlers() {
        // Twilio save button
        const twilioBtn = document.getElementById('save-twilio-btn');
        if (twilioBtn) {
            twilioBtn.addEventListener('click', () => this.saveTwilioCredentials());
        }
        
        // Add contact button
        const addBtn = document.getElementById('add-contact-btn');
        if (addBtn) {
            addBtn.addEventListener('click', () => this.addAdminContact());
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
